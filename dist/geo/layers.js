const url = name => new URL(name, import.meta.url).href;

async function loadFile(name) {
  const response = await fetch(url(name));
  if (!response.ok) throw new Error('无法打开地图文件 ' + name);
  return response;
}

// The two packaged DSM grids contain WGS 84 ellipsoid heights in whole metres.
// Samples are placed on the grid intersections, row zero at the north edge.
function interpolate(grid, lon, lat) {
  const [west, south, east, north] = grid.bounds;
  const x = (lon - west) * (grid.width - 1) / (east - west);
  const y = (north - lat) * (grid.height - 1) / (north - south);
  const i = Math.max(0, Math.min(grid.width - 2, Math.floor(x)));
  const j = Math.max(0, Math.min(grid.height - 2, Math.floor(y)));
  const k = j * grid.width + i;
  const a = x - i, b = y - j, h = grid.heights;
  const top = h[k] * (1 - a) + h[k + 1] * a;
  const bottom = h[k + grid.width] * (1 - a) + h[k + grid.width + 1] * a;
  return top * (1 - b) + bottom * b;
}

function makeTerrain(C, grids) {
  const scheme = new C.GeographicTilingScheme();
  const size = 33;
  const flat = new Float32Array(size * size);
  return new C.CustomHeightmapTerrainProvider({
    width: size, height: size, tilingScheme: scheme,
    callback(x, y, level) {
      const rect = scheme.tileXYToRectangle(x, y, level);
      const [west, south, east, north] = [rect.west, rect.south, rect.east, rect.north].map(rad => C.Math.toDegrees(rad));
      const overlap = grids.filter(({ bounds: [w,s,e,n] }) => w <= east && s <= north && e >= west && n >= south);
      if (!overlap.length) return flat;
      const heights = new Float32Array(size * size);
      for (let row = 0; row < size; row++) {
        const lat = north - (north - south) * row / (size - 1);
        for (let col = 0; col < size; col++) {
          const lon = west + (east - west) * col / (size - 1);
          for (const grid of overlap) {
            const [w,s,e,n] = grid.bounds;
            if (lon >= w && lon <= e && lat >= s && lat <= n) {
              heights[row * size + col] = interpolate(grid, lon, lat);
              break;
            }
          }
        }
      }
      return heights;
    }
  });
}

// Published runway endpoints and widths from OurAirports' ZGSZ records.
// The outline is constructed from a centreline and its published width.
const runways = [
  { name: '15 / 33', a: [113.8030014,22.6529999], b: [113.8180008,22.6256008], width: 45.1104 },
  { name: '16L / 34R', a: [113.784851,22.654461], b: [113.801620,22.623880], width: 60.0456 },
  { name: '16R / 34L', a: [113.776337,22.659056], b: [113.792221,22.630083], width: 45.1104 }
];

function addRunways(viewer, C) {
  const lineColor = C.Color.fromCssColorString('#ffe5ad').withAlpha(.9);
  for (const runway of runways) {
    const {a,b,width,name} = runway;
    const mLon = 111320 * Math.cos(C.Math.toRadians((a[1] + b[1]) / 2));
    const dx = (b[0] - a[0]) * mLon, dy = (b[1] - a[1]) * 110760;
    const length = Math.hypot(dx,dy);
    const ox = -dy / length * width / 2 / mLon, oy = dx / length * width / 2 / 110760;
    const outline = [a[0]+ox,a[1]+oy, b[0]+ox,b[1]+oy, b[0]-ox,b[1]-oy, a[0]-ox,a[1]-oy, a[0]+ox,a[1]+oy];
    viewer.entities.add({
      name: '宝安机场跑道 ' + name,
      polyline: {
        positions: C.Cartesian3.fromDegreesArray(outline), clampToGround: true, width: 1.7, material: lineColor,
        distanceDisplayCondition: new C.DistanceDisplayCondition(0, 68000)
      },
      position: C.Cartesian3.fromDegrees(a[0], a[1]),
      label: {text:name, font:'13px sans-serif', fillColor:C.Color.WHITE,
        showBackground:true, backgroundColor:C.Color.fromCssColorString('#22343bdc'),
        heightReference:C.HeightReference.CLAMP_TO_GROUND,
        pixelOffset:new C.Cartesian2(0,-12),disableDepthTestDistance:Number.POSITIVE_INFINITY,
        distanceDisplayCondition:new C.DistanceDisplayCondition(0,12000)}
    });
  }
}

export async function addGeography(viewer, C) {
  const manifest = await (await loadFile('layers.json')).json();
  const imagery = await Promise.all(manifest.imagery.map(({url: name,bounds}) =>
    C.SingleTileImageryProvider.fromUrl(url(name), { rectangle:C.Rectangle.fromDegrees(...bounds) })));
  if (!viewer.imageryLayers.length) {
    const earth = await C.TileMapServiceImageryProvider.fromUrl(
      C.buildModuleUrl('Assets/Textures/NaturalEarthII/'));
    viewer.imageryLayers.addImageryProvider(earth);
  }
  for (const provider of imagery) viewer.imageryLayers.addImageryProvider(provider);
  const credit = new C.Credit('<a href="https://cloudless.eox.at/">EOxCloudless</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025) · <a href="./geo/sources.html" target="_blank" rel="noopener">地图数据</a>', true);
  viewer.creditDisplay.addStaticCredit(credit);
  const grids = await Promise.all(manifest.terrain.map(async grid => {
    const data = await (await loadFile(grid.url)).arrayBuffer();
    if (data.byteLength !== grid.width * grid.height * 2) throw new Error('地形数据不完整');
    return {...grid, heights:new Int16Array(data)};
  }));
  viewer.terrainProvider = makeTerrain(C, grids.reverse());
  addRunways(viewer, C);
  viewer.scene.requestRender();
  return {imagery, terrain:viewer.terrainProvider, runways:runways.length, status:'全球 Sentinel-2 影像 · 区域地形 · 3 条跑道'};
}
