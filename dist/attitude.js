const radians = Math.PI / 180;
const earthRadius = 6371008.8;
const gravity = 9.80665;

export function course(from, to) {
  const meanLatitude = (from.lat + to.lat) * radians / 2;
  const east = earthRadius * Math.cos(meanLatitude) * (to.lon - from.lon) * radians;
  const north = earthRadius * (to.lat - from.lat) * radians;
  return { heading: Math.atan2(east, north), distance: Math.hypot(east, north) };
}

export function estimateAttitudes(points, gaps) {
  const breaks = new Set(gaps.map(gap => gap.from));
  const attitudes = [];
  let first = 0;
  let last = 0;
  let heading = course(points[0], points[1]).heading;
  for (const [index, point] of points.entries()) {
    if (index > last) first = last = index;
    while (last < points.length - 1 && !breaks.has(last)) last++;
    let before = index;
    let after = index;
    while (before > first && point.t - points[before].t < 8) before--;
    while (after < last && points[after].t - point.t < 8) after++;
    const forward = course(points[before], points[after]);
    if (forward.distance > 12) heading = forward.heading;
    const leadTime = point.t - points[before].t;
    const trailTime = points[after].t - point.t;
    let acceleration = null;
    if (leadTime >= 4 && trailTime >= 4 && point.speed >= 150 && point.alt >= 50) {
      const incoming = course(points[before], point);
      const outgoing = course(point, points[after]);
      const angle = outgoing.heading - incoming.heading;
      const signedTurn = Math.atan2(Math.sin(angle), Math.cos(angle));
      const turnRate = signedTurn / ((leadTime + trailTime) / 2);
      acceleration = point.speed / 3.6 * turnRate;
    }
    attitudes.push({ heading, acceleration });
  }
  return attitudes;
}

export function bankDegrees(acceleration, gain) {
  return acceleration === null ? null : Math.atan(gain * acceleration / gravity) / radians;
}
