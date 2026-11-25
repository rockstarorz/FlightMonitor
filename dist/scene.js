import { bankDegrees, course } from "./attitude.js";

// All flight coordinates are WGS84. Heights used for rendering are ellipsoidal.
const views = {
  all: { first: 0, last: Infinity, heading: -9, pitch: -46 },
  approach: { first: 1790, last: 2530, heading: 21, pitch: -37 },
  airport: { first: 2484, last: Infinity, heading: -18, pitch: -73 }
};

export async function createScene(container, flight, { onSeek, onLayerState }) {
  const C = window.Cesium;
  const viewer = new C.Viewer(container, {
    animation: false, timeline: false, baseLayerPicker: false, geocoder: false,
    baseLayer: false, skyBox: false, navigationHelpButton: false, homeButton: false,
    sceneModePicker: false, fullscreenButton: false, selectionIndicator: false,
    infoBox: false, shouldAnimate: false, scene3DOnly: true,
    requestRenderMode: true, maximumRenderTimeChange: Infinity,
    contextOptions: { webgl: { alpha: false, antialias: true } }
  });
  const { scene, camera, entities } = viewer;
  const { points, gaps, attitudes } = flight;
  const color = C.Color.fromCssColorString;
  const measured = color('#62ede1');
  const missing = color('#ff9c41');
  const outline = color('#153238');
  const heightYellow = color('#fff185');
  const heightAnchor = color('#d2f0ed').withAlpha(0.62);
  const gapIndices = new Set(gaps.map(gap => gap.from));
  let verticalScale = 1;
  let currentTime = 0;
  let bankGain = 1;
  let positions = [];
  let lines = [];
  let curtains = [];
  let aircraft;
  let startPoint;
  let endPoint;
  let placeLabels = [];
  let activeView = 'all';
  let refitOnResize = true;
  let internalMove = false;

  viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 1.6);
  scene.globe.baseColor = color('#334c51');
  scene.globe.depthTestAgainstTerrain = false;
  scene.globe.enableLighting = false;
  scene.globe.showGroundAtmosphere = false;
  scene.fog.enabled = false;
  if (scene.sun) scene.sun.show = false;
  if (scene.moon) scene.moon.show = false;
  scene.backgroundColor = color('#22363e');
  scene.screenSpaceCameraController.minimumZoomDistance = 30;
  scene.screenSpaceCameraController.maximumZoomDistance = 35000000;
  if (scene.postProcessStages.fxaa) scene.postProcessStages.fxaa.enabled = true;
  if (viewer.screenSpaceEventHandler) {
    viewer.screenSpaceEventHandler.removeInputAction(C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  }
  const actualSegments = [];
  let first = 0;
  for (const gap of gaps) {
    actualSegments.push([first, gap.from]);
    first = gap.to;
  }
  actualSegments.push([first, points.length - 1]);

  function coordinate(point) {
    const seaOffset = Number.isFinite(point.alt) ? point.h - point.alt : 0;
    return C.Cartesian3.fromDegrees(point.lon, point.lat,
      seaOffset + (point.h - seaOffset) * verticalScale);
  }

  function lineEntity(from, to, gap) {
    if (from === to) return;
    const stroke = gap ? missing : measured;
    const material = new C.PolylineOutlineMaterialProperty({
      color: stroke, outlineColor: outline.withAlpha(0.87), outlineWidth: 1.2
    });
    const entity = entities.add({ polyline: {
      positions: positions.slice(from, to + 1), width: gap ? 5.4 : 4.6,
      arcType: C.ArcType.NONE, material
    } });
    lines.push({ entity, from, to, gap });
  }

  function drawHeightCurtain(from, to) {
    // A translucent skirt gives an altitude cue in an oblique view. It belongs
    // only to measured airborne segments; estimated gap lines remain separate.
    const samples = [];
    for (let i = from; i <= to; i++) {
      if (points[i].alt < 200 || points[i].alt === null) continue;
      if (samples.length === 0 || i === to || i % 5 === 0) samples.push(positions[i]);
    }
    if (samples.length < 2) return;
    curtains.push(entities.add({ wall: {
      positions: samples, minimumHeights: samples.map(() => 0),
      material: heightYellow.withAlpha(0.32), outline: false
    } }));
  }

  function labelStyle(text, offset, size = 14) {
    return {
      text, font: '500 ' + size + 'px "PingFang SC", "Microsoft YaHei", sans-serif',
      fillColor: C.Color.WHITE, outlineColor: color('#112526'), outlineWidth: 3.2,
      style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: offset,
      horizontalOrigin: C.HorizontalOrigin.LEFT, verticalOrigin: C.VerticalOrigin.CENTER,
      disableDepthTestDistance: Infinity
    };
  }

  function endpoint(index, text, offset) {
    return entities.add({
      position: positions[index],
      point: { pixelSize: 8, color: C.Color.WHITE, outlineColor: outline, outlineWidth: 2,
        disableDepthTestDistance: Infinity },
      label: labelStyle(text, offset)
    });
  }

  function rebuildGeometry() {
    entities.suspendEvents();
    try {
      for (const { entity } of lines) entities.remove(entity);
      lines = [];
      for (const curtain of curtains) entities.remove(curtain);
      curtains = [];
      positions = points.map(coordinate);
      for (const [from, to] of actualSegments) {
        lineEntity(from, to, false);
        drawHeightCurtain(from, to);
      }
      for (const gap of gaps) lineEntity(gap.from, gap.to, true);
      if (startPoint) startPoint.position = positions[0];
      if (endPoint) endPoint.position = positions.at(-1);
    } finally {
      entities.resumeEvents();
    }
  }

  rebuildGeometry();
  startPoint = endpoint(0, '广西 · 起始记录', new C.Cartesian2(12, -13));
  endPoint = endpoint(points.length - 1, '深圳宝安机场', new C.Cartesian2(12, -12));
  for (const [lon, lat, name] of [[111.279, 23.48, '梧州'], [112.466, 23.048, '肇庆'],
    [113.265, 23.126, '广州'], [113.38, 22.518, '中山']]) {
    placeLabels.push(entities.add({
      position: C.Cartesian3.fromDegrees(lon, lat, 90),
      label: { ...labelStyle(name, new C.Cartesian2(5, 4), 12),
        fillColor: heightAnchor, distanceDisplayCondition: new C.DistanceDisplayCondition(90000, 1200000) }
    }));
  }
  aircraft = entities.add({
    position: positions[0],
    model: {
      uri: new URL('./models/jet.glb', import.meta.url).href,
      minimumPixelSize: 57,
      maximumScale: 2000,
      silhouetteColor: outline,
      silhouetteSize: 1.1,
      colorBlendMode: C.ColorBlendMode.MIX,
      colorBlendAmount: 0.65
    }
  });

  function upperIndex(seconds) {
    let lo = 0;
    let hi = points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid].t < seconds) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function setTime(seconds) {
    currentTime = C.Math.clamp(seconds, 0, points.at(-1).t);
    const hi = upperIndex(currentTime);
    const lo = Math.max(0, hi - 1);
    const fraction = hi === lo ? 0 : (currentTime - points[lo].t) / (points[hi].t - points[lo].t);
    const location = C.Cartesian3.lerp(positions[lo], positions[hi], fraction, new C.Cartesian3());
    const inGap = gapIndices.has(lo) && fraction > 0 && fraction < 1;
    const attitude = attitudes[fraction < 0.5 ? lo : hi];
    const heading = inGap ? course(points[lo], points[hi]).heading : attitude.heading;
    const bank = inGap ? 0 : bankDegrees(attitude.acceleration, bankGain) ?? 0;
    aircraft.position = location;
    aircraft.orientation = C.Transforms.headingPitchRollQuaternion(location,
      new C.HeadingPitchRoll(heading - Math.PI / 2, 0, C.Math.toRadians(bank)));
    aircraft.model.color = inGap ? missing : C.Color.WHITE;
    scene.requestRender();
  }

  function setBankGain(value) {
    bankGain = value;
    setTime(currentTime);
  }

  function setScale(value) {
    if (!Number.isFinite(value) || value <= 0 || value === verticalScale) return;
    verticalScale = value;
    rebuildGeometry();
    setTime(currentTime);
    if (refitOnResize) setView(activeView);
  }

  function setView(name) {
    const preset = views[name];
    if (!preset) return;
    activeView = name;
    refitOnResize = true;
    internalMove = true;
    try {
      const start = upperIndex(preset.first);
      const end = upperIndex(preset.last);
      const samples = [];
      const stride = Math.max(1, Math.floor((end - start) / 130));
      for (let i = start; i < end; i += stride) samples.push(positions[i]);
      samples.push(positions[end]);
      if (name === 'airport') {
        // Include the approaches and airport-side context around the surface track.
        samples.push(C.Cartesian3.fromDegrees(113.806, 22.619, 0));
      }
      const sphere = C.BoundingSphere.fromPoints(samples);
      const offset = new C.HeadingPitchRange(C.Math.toRadians(preset.heading),
        C.Math.toRadians(preset.pitch), Math.max(1500, sphere.radius * 2.5));
      const w = scene.canvas.clientWidth;
      const h = scene.canvas.clientHeight;
      const narrow = w < 500;
      endPoint.label.horizontalOrigin = narrow ? C.HorizontalOrigin.RIGHT : C.HorizontalOrigin.LEFT;
      endPoint.label.pixelOffset = narrow ? new C.Cartesian2(-10, 17) : new C.Cartesian2(12, -12);
      viewer.resize();
      const project = point => C.SceneTransforms.worldToWindowCoordinates(scene, point);
      // Fit the actual projected track. A sphere alone over-zooms on narrow screens.
      for (let pass = 0; pass < 4; pass++) {
        camera.lookAt(sphere.center, offset);
        camera.lookAtTransform(C.Matrix4.IDENTITY);
        if (w < 50 || h < 50 || pass === 3) break;
        let ratio = 0;
        for (const point of samples) {
          const xy = project(point);
          if (!xy) { ratio = 2; break; }
          const side = xy.x > w / 2 ? Math.max(w * .30, w / 2 - 118) : w * .43;
          ratio = Math.max(ratio, Math.abs(xy.x - w / 2) / side,
            Math.abs(xy.y - h / 2) / (h * .37));
        }
        if (Math.abs(ratio - 1) < .025 || ratio === 0) break;
        offset.range *= C.Math.clamp(ratio, .55, 1.8);
      }
      for (const place of placeLabels) place.show = name === 'all';
      scene.requestRender();
    } finally {
      internalMove = false;
    }
  }

  function segmentTime(screen, range) {
    let closestDistance = Infinity;
    let time = null;
    const first = range ? range.from : 0;
    const last = range ? range.to : points.length - 1;
    const projected = new C.Cartesian2();
    let previous;
    for (let i = first; i <= last; i++) {
      const p = C.SceneTransforms.worldToWindowCoordinates(scene, positions[i], projected);
      if (!p) { previous = null; continue; }
      if (previous) {
        const dx = p.x - previous.x;
        const dy = p.y - previous.y;
        const length = dx * dx + dy * dy;
        const k = length > 0 ? C.Math.clamp(((screen.x - previous.x) * dx +
          (screen.y - previous.y) * dy) / length, 0, 1) : 0;
        const distance = Math.hypot(screen.x - previous.x - k * dx, screen.y - previous.y - k * dy);
        if (distance < closestDistance) {
          closestDistance = distance;
          time = gapIndices.has(i - 1)
            ? points[i - 1].t + (points[i].t - points[i - 1].t) * C.Math.clamp(k, .02, .98)
            : points[k < .5 ? i - 1 : i].t;
        }
      }
      if (!previous) previous = new C.Cartesian2();
      C.Cartesian2.clone(p, previous);
    }
    return range || closestDistance <= 11 ? time : null;
  }

  const handler = new C.ScreenSpaceEventHandler(scene.canvas);
  handler.setInputAction(({ position }) => {
    const picked = scene.pick(position, 7, 7)?.id;
    if (picked === aircraft) return;
    if (picked === startPoint) return onSeek?.(points[0].t);
    if (picked === endPoint) return onSeek?.(points.at(-1).t);
    const time = segmentTime(position, lines.find(line => line.entity === picked));
    if (time !== null) onSeek?.(time);
  }, C.ScreenSpaceEventType.LEFT_CLICK);

  for (const type of ['pointerdown', 'wheel']) scene.canvas.addEventListener(type, () => {
    if (!internalMove) refitOnResize = false;
  }, { passive: true });
  const cameraKeys = new Set([
    'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyF', 'KeyR', 'Space', 'ShiftLeft', 'ShiftRight'
  ]);
  const heldKeys = new Set();
  let motionFrame = 0;
  let previousTime = 0;
  const localUp = new C.Cartesian3();
  const tangentFrame = new C.Matrix4();
  const offset = new C.Cartesian3();
  const destination = new C.Cartesian3();
  const nextPosition = new C.Cartographic();

  function moveAlongSurface(forward, right, distance) {
    const ellipsoid = scene.globe.ellipsoid;
    const heading = camera.heading;
    const orientation = { heading, pitch: camera.pitch, roll: camera.roll };
    const height = camera.positionCartographic.height;
    const step = distance / Math.hypot(forward, right);
    offset.x = (forward * Math.sin(heading) + right * Math.cos(heading)) * step;
    offset.y = (forward * Math.cos(heading) - right * Math.sin(heading)) * step;
    offset.z = 0;
    C.Transforms.eastNorthUpToFixedFrame(camera.positionWC, ellipsoid, tangentFrame);
    C.Matrix4.multiplyByPoint(tangentFrame, offset, destination);
    // Reproject each tangent step to the original ellipsoidal height.
    ellipsoid.cartesianToCartographic(destination, nextPosition);
    nextPosition.height = height;
    ellipsoid.cartographicToCartesian(nextPosition, destination);
    camera.setView({ destination, orientation });
  }

  function stopCameraMotion() {
    heldKeys.clear();
    cancelAnimationFrame(motionFrame);
    motionFrame = 0;
    previousTime = 0;
  }

  function moveCamera(now) {
    const elapsed = previousTime ? Math.min((now - previousTime) / 1000, .05) : 0;
    previousTime = now;
    const distance = C.Math.clamp(camera.positionCartographic.height * .52, 75, 6e6) * elapsed;
    const angle = C.Math.toRadians(48) * elapsed;
    const axis = (positive, negative) => Number(heldKeys.has(positive)) - Number(heldKeys.has(negative));
    const forward = axis('KeyW', 'KeyS');
    const right = axis('KeyD', 'KeyA');
    const yaw = axis('KeyE', 'KeyQ');
    const pitch = axis('KeyF', 'KeyR');
    const up = Number(heldKeys.has('Space')) - Number(heldKeys.has('ShiftLeft') || heldKeys.has('ShiftRight'));
    if ((forward || right) && distance > 0) moveAlongSurface(forward, right, distance);
    if ((yaw || pitch) && angle > 0) {
      const currentPitch = camera.pitch;
      // Cesium's heading and pitch use the local east–north–up frame.
      // Keep roll and position fixed while rotating relative to that frame.
      camera.setView({
        destination: C.Cartesian3.clone(camera.positionWC, destination),
        orientation: {
          heading: camera.heading + yaw * angle,
          pitch: pitch
            ? C.Math.clamp(currentPitch + pitch * angle, -C.Math.PI_OVER_TWO, C.Math.PI_OVER_TWO)
            : currentPitch,
          roll: camera.roll
        }
      });
    }
    if (up) {
      scene.globe.ellipsoid.geodeticSurfaceNormal(camera.positionWC, localUp);
      camera.move(localUp, up * distance);
    }
    scene.requestRender();
    motionFrame = requestAnimationFrame(moveCamera);
  }

  container.addEventListener('keydown', event => {
    if (!cameraKeys.has(event.code) || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    heldKeys.add(event.code);
    if (!motionFrame) {
      refitOnResize = false;
      camera.cancelFlight();
      motionFrame = requestAnimationFrame(moveCamera);
    }
  });
  window.addEventListener('keyup', event => {
    if (!heldKeys.delete(event.code)) return;
    if (!heldKeys.size) stopCameraMotion();
  });
  window.addEventListener('blur', stopCameraMotion);
  container.addEventListener('focusout', stopCameraMotion);
  scene.canvas.addEventListener('pointerdown', () => container.focus({ preventScroll: true }));

  let resizeTimer;
  const observer = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      viewer.resize();
      if (refitOnResize) setView(activeView);
      else scene.requestRender();
    }, 60);
  });
  observer.observe(container);
  setView('all');
  setTime(0);
  onLayerState?.('正在加载地形和影像');
  import('./geo/layers.js').then(module => module.addGeography(viewer, C)).then(result => {
    onLayerState?.(result?.status || '地形与影像已载入');
    scene.requestRender();
  }).catch(error => {
    console.warn('地图图层加载失败', error);
    onLayerState?.('底图未载入 · 航迹可用');
  });
  return { setTime, setView, setScale, setBankGain };
}
