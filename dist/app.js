import { createScene } from './scene.js';
import { bankDegrees, estimateAttitudes } from './attitude.js';

const byId = id => document.getElementById(id);
const formatTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});

async function start() {
  const response = await fetch('./data/flight.json');
  if (!response.ok) throw new Error('无法读取航迹数据');
  const { points, gaps, duration, startUnixMs, distanceKm, ...metadata } = await response.json();
  const clock = seconds => formatTime.format(startUnixMs + Math.floor(seconds) * 1000);
  const slider = byId('seek');
  const canvas = byId('profile');
  const ctx = canvas.getContext('2d');
  const staticChart = document.createElement('canvas');
  const attitudes = estimateAttitudes(points, gaps);
  let bankGain = 1;
  const gapStarts = new Set(gaps.map(gap => gap.from));
  let scene;
  let time = 0;
  let playing = false;
  let frame = 0;
  let previousFrame;
  let width = 0;
  let height = 0;
  const left = 46;
  const right = 42;
  const plotX = secs => left + secs / duration * (width - left - right);
  const plotY = fraction => 8 + (1 - fraction) * (height - 27);
  const groundSpeed = 950;
  const maxAlt = 9000;

  byId('km').textContent = distanceKm.toFixed(1);
  byId('npts').textContent = points.length.toLocaleString('zh-CN');
  byId('ngap').textContent = gaps.length + ' 处';
  byId('endTime').textContent = clock(duration);
  slider.max = duration;

  const gapButtons = gaps.map(gap => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gaprow';
    const start = points[gap.from].t;
    const end = points[gap.to].t;
    btn.title = clock(start) + ' – ' + clock(end) + '，两端相距 ' + gap.distanceKm.toFixed(2) + ' km';
    const label = document.createElement('span');
    label.textContent = clock(start) + ' 起';
    const span = document.createElement('span');
    span.textContent = gap.duration + ' 秒';
    btn.append(label, span);
    btn.addEventListener('click', () => seek((start + end) / 2));
    byId('gapList').append(btn);
    return btn;
  });

  function drawStaticChart() {
    const dpr = devicePixelRatio || 1;
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = staticChart.width = Math.round(width * dpr);
    canvas.height = staticChart.height = Math.round(height * dpr);
    const bg = staticChart.getContext('2d');
    bg.scale(dpr, dpr);
    bg.font = '10px SFMono-Regular, monospace';
    bg.strokeStyle = '#344549';
    bg.fillStyle = '#a1b3b5';
    bg.textBaseline = 'middle';
    for (const fraction of [0, 0.5, 1]) {
      const y = plotY(fraction);
      bg.beginPath();
      bg.moveTo(left, y); bg.lineTo(width - right, y); bg.stroke();
      bg.textAlign = 'right';
      bg.fillText(fraction * maxAlt / 1000 + ' km', left - 5, y);
      bg.textAlign = 'left';
      bg.fillText(String(fraction * groundSpeed), width - right + 6, y);
    }
    for (let t = 0; t < duration; t += width > 560 ? 600 : 1200) {
      bg.textAlign = t === 0 ? 'left' : 'center';
      bg.fillText(clock(t).slice(0, 5), plotX(t), height - 7);
    }
    bg.fillStyle = '#ffad672c';
    for (const gap of gaps) {
      const x = plotX(points[gap.from].t);
      bg.fillRect(x, plotY(1), Math.max(1, plotX(points[gap.to].t) - x), plotY(0) - plotY(1));
    }
    for (const [key, max, color] of [['alt', maxAlt, '#fff185'], ['speed', groundSpeed, '#acbdf6']]) {
      bg.beginPath();
      bg.strokeStyle = color;
      bg.lineWidth = 1.6;
      let needStart = true;
      points.forEach((point, i) => {
        if (point[key] === null) {
          needStart = true;
          return;
        }
        const x = plotX(point.t);
        const y = plotY(Math.max(0, point[key] / max));
        if (needStart || gapStarts.has(i - 1)) bg.moveTo(x, y);
        else bg.lineTo(x, y);
        needStart = false;
      });
      bg.stroke();
    }
    bg.beginPath();
    bg.strokeStyle = '#ffad67';
    bg.lineWidth = 2;
    for (const gap of gaps) {
      const from = points[gap.from], to = points[gap.to];
      if (from.alt === null || to.alt === null) continue;
      bg.moveTo(plotX(from.t), plotY(Math.max(0, from.alt / maxAlt)));
      bg.lineTo(plotX(to.t), plotY(Math.max(0, to.alt / maxAlt)));
    }
    bg.stroke();
    drawCursor();
  }

  function drawCursor() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(staticChart, 0, 0);
    ctx.save();
    ctx.scale(devicePixelRatio || 1, devicePixelRatio || 1);
    ctx.strokeStyle = '#ffe6b1';
    ctx.beginPath();
    ctx.moveTo(plotX(time), 3);
    ctx.lineTo(plotX(time), plotY(0) + 4);
    ctx.stroke();
    ctx.restore();
  }

  function readout() {
    let lo = 0, hi = points.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (points[mid].t < time) lo = mid + 1;
      else hi = mid;
    }
    const gapIndex = gaps.findIndex(gap => points[gap.from].t < time && time < points[gap.to].t);
    const gap = gaps[gapIndex];
    const prev = points[Math.max(0, lo - 1)];
    const next = points[lo];
    const pointIndex = time - prev.t < next.t - time ? Math.max(0, lo - 1) : lo;
    const point = points[pointIndex];
    const from = gap && points[gap.from];
    const to = gap && points[gap.to];
    const altitude = gap && from.alt !== null && to.alt !== null
      ? from.alt + (to.alt - from.alt) * (time - from.t) / gap.duration
      : gap ? null : point.alt;
    const feet = altitude === null ? null : altitude / 0.3048;
    const acceleration = gap ? null : attitudes[pointIndex].acceleration;
    const bank = bankDegrees(acceleration, bankGain);
    const quality = byId('quality');
    quality.classList.toggle('gap', Boolean(gap));
    quality.textContent = gap ? '空档 · 海拔插值' : point.altEstimated ? 'GPS Fix · 海拔估算' : point.source;
    byId('clock').textContent = byId('playTime').textContent = clock(gap ? time : point.t);
    const rounded = value => value === null ? '—' : Math.round(value).toLocaleString('zh-CN');
    byId('alt').textContent = rounded(altitude);
    byId('feet').textContent = rounded(feet);
    byId('flightLevel').textContent = feet === null || feet < 1000
      ? '—' : '≈ FL' + String(Math.round(feet / 100)).padStart(3, '0');
    byId('bankAngle').textContent = bank === null ? '—'
      : Math.abs(bank).toFixed(1) + '°' + (Math.abs(bank) < 0.05 ? '' : bank < 0 ? ' 左' : ' 右');
    byId('accel').textContent = '横向加速度 ' + (acceleration === null ? '—'
      : Math.abs(acceleration).toFixed(2) + ' m/s²' + (acceleration < 0 ? ' 左' : ' 右'));
    byId('speed').textContent = gap ? '—' : rounded(point.speed);
    byId('coord').textContent = gap
      ? clock(points[gap.from].t) + ' – ' + clock(points[gap.to].t) + ' · ' + gap.duration + ' 秒'
      : point.lat.toFixed(5) + '°N  /  ' + point.lon.toFixed(5) + '°E';
    byId('fields').textContent = gap
      ? '两端相距 ' + gap.distanceKm.toFixed(2) + ' km，高度差 ' +
        (points[gap.to].h - points[gap.from].h).toFixed(1) + ' m（椭球高）。海拔与飞机位置沿直线插值。'
      : '采样 ' + clock(point.t) + ' · 椭球高 ' + point.h.toFixed(1) + ' m · 卫星 ' +
        (point.sv ?? '—') + ' · HDOP ' + (point.hdop ?? '—') + ' · GGA 定位质量 ' + (point.fixQuality ?? '—');
    byId('raw').textContent = gap ? '' : point.raw.join('\n');
    gapButtons.forEach((btn, i) => btn.classList.toggle('active', i === gapIndex));
  }

  function update(seconds) {
    time = Math.max(0, Math.min(duration, seconds));
    slider.value = Math.round(time);
    slider.setAttribute('aria-valuetext', clock(time));
    scene?.setTime(time);
    readout();
    drawCursor();
  }

  function pause() {
    playing = false;
    cancelAnimationFrame(frame);
    byId('play').setAttribute('aria-label', '播放');
    byId('playIcon').textContent = '▶';
    byId('playText').textContent = '播放';
  }

  function seek(seconds) {
    pause();
    update(seconds);
  }

  function animate(now) {
    if (!playing) return;
    if (previousFrame) update(time + Math.min(0.25, (now - previousFrame) / 1000) * Number(byId('rate').value));
    previousFrame = now;
    if (time >= duration) pause();
    else frame = requestAnimationFrame(animate);
  }

  byId('play').addEventListener('click', () => {
    if (playing) return pause();
    if (time >= duration) update(0);
    playing = true;
    previousFrame = 0;
    byId('play').setAttribute('aria-label', '暂停');
    byId('playIcon').textContent = 'Ⅱ';
    byId('playText').textContent = '暂停';
    frame = requestAnimationFrame(animate);
  });
  slider.addEventListener('input', () => seek(Number(slider.value)));
  canvas.addEventListener('click', event => {
    const x = event.clientX - canvas.getBoundingClientRect().left;
    seek(Math.round((x - left) / (width - left - right) * duration));
  });
  const viewButtons = [...document.querySelectorAll('[data-view]')];
  for (const btn of viewButtons) {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      for (const button of viewButtons) button.setAttribute('aria-pressed', String(button === btn));
      scene?.setView(view);
      seek({ all: 0, approach: 2241, airport: 2490 }[view]);
    });
  }
  byId('scale').addEventListener('change', event => scene?.setScale(Number(event.target.value)));
  byId('bankGain').addEventListener('input', event => {
    bankGain = Number(event.target.value);
    byId('gainValue').textContent = bankGain.toFixed(2) + '×';
    scene?.setBankGain(bankGain);
    readout();
  });
  new ResizeObserver(drawStaticChart).observe(canvas);
  drawStaticChart();
  update(0);

  try {
    scene = await createScene(byId('map'), { points, gaps, duration, startUnixMs, attitudes, ...metadata }, {
      onSeek: seek, onLayerState: state => { byId('layerState').textContent = state; }
    });
    scene.setView(viewButtons.find(btn => btn.getAttribute('aria-pressed') === 'true').dataset.view);
    scene.setScale(Number(byId('scale').value));
    scene.setBankGain(bankGain);
    scene.setTime(time);
    byId('mapMessage').textContent = '';
  } catch (error) {
    console.error(error);
    byId('mapMessage').textContent = '三维地图加载失败。可以继续查看时间轴和定位数据。';
  }
}

start().catch(error => {
  console.error(error);
  byId('mapMessage').textContent = '无法载入航迹。请用项目的启动脚本打开页面。';
});
