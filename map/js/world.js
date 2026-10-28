// The world both views draw: one set of points on the sphere, a height and a
// low-poly colour for every point and triangle, and the Equal Earth projection
// the flat map uses. The 2D map and the 3D globe build their triangles from
// the same points and colour them with the same palette, so they compare
// facet for facet.
import Delaunator from './vendor/delaunator.js';

const GW = 1024, GH = 512;
const D2R = Math.PI / 180;

// ---------- elevation grid (see build/build-grid.mjs for the encoding) ----------

export async function loadGrid(url) {
  const res = await fetch(url);
  let buf = new Uint8Array(await res.arrayBuffer());
  // A server may already have undone the gzip (Content-Encoding); only
  // decompress when the gzip magic is still there.
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    buf = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  if (buf.length !== GW * GH) throw new Error(`elevation grid is ${buf.length} bytes, expected ${GW * GH}`);
  const metres = new Float32Array(GW * GH);
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    metres[i] = v >= 100 ? 8800 * ((v - 100) / 155) ** 2 : -11000 * ((99 - v) / 99) ** 2;
  }
  return { bytes: buf, metres };
}

function cellIndex(lon, lat) {
  let c = Math.floor((lon + 180) / 360 * GW);
  c = ((c % GW) + GW) % GW;
  const r = Math.min(GH - 1, Math.max(0, Math.floor((90 - lat) / 180 * GH)));
  return r * GW + c;
}

export function isLand(grid, lon, lat) { return grid.bytes[cellIndex(lon, lat)] >= 100; }

// Bilinear height in metres, kept on the right side of sea level for the cell
// the point falls in, so a coastline doesn't smear into the shelf.
export function heightAt(grid, lon, lat) {
  const fx = (lon + 180) / 360 * GW - 0.5, fy = Math.min(GH - 1.001, Math.max(0, (90 - lat) / 180 * GH - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const g = (x, y) => grid.metres[y * GW + (((x % GW) + GW) % GW)];
  const h = (g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx) * (1 - ty) + (g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx) * ty;
  return isLand(grid, lon, lat) ? Math.max(h, 20) : Math.min(h, -20);
}

// Relief exaggeration shared by both views: metres -> globe radii (1 = Earth's
// radius). The map shades facets with it; the globe pushes vertices out by it.
export const RELIEF = 50 / 6371000;

// ---------- small deterministic noise ----------

function hash(x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), tx = x - xi, ty = y - yi;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}
function fbm(x, y) { return vnoise(x, y) * 0.55 + vnoise(x * 2.1 + 7, y * 2.1 + 3) * 0.3 + vnoise(x * 4.3 + 1, y * 4.3 + 9) * 0.15; }

function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- biomes and palette ----------

// Rough dry regions [lon, lat, half-width°, half-height°]. Climate data would
// be better; for a stylised map these blobs plus noise read correctly.
const DRY = [
  [10, 23, 26, 8], [47, 23, 11, 8], [70, 27, 5, 4], [58, 31, 9, 5], [62, 43, 11, 5],
  [103, 42, 13, 5], [83, 39, 7, 3], [133, -25, 15, 8], [18, -24, 6, 6], [-70.5, -23, 2, 9],
  [-68, -45, 4, 6], [-112, 33, 7, 5], [-117, 40, 4, 4], [-104, 28, 4, 4], [46, 9, 6, 4],
  [37, 36, 4, 3], [-1, 39, 2, 2], [-40, -8, 3, 3],
];
function aridity(lon, lat) {
  let a = 0;
  for (const [x, y, w, h] of DRY) {
    let dx = lon - x; if (dx > 180) dx -= 360; if (dx < -180) dx += 360;
    const d = (dx / w) ** 2 + ((lat - y) / h) ** 2;
    a = Math.max(a, Math.exp(-d * 1.2));
  }
  return Math.min(1, a * (0.75 + 0.5 * fbm(lon * 0.15, lat * 0.15)));
}

const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
export const PALETTE = {
  abyss: hex('#14295a'), deep: hex('#1f4782'), ocean: hex('#2f6fae'), shelf: hex('#4fa3cf'), lagoon: hex('#7cc8dc'),
  seaIce: hex('#d6e8f2'), sand: hex('#ead29a'), desert: hex('#dcaa62'), steppe: hex('#c3c174'),
  grass: hex('#9cc85e'), forest: hex('#56a24c'), jungle: hex('#2f8a45'), boreal: hex('#3f7454'),
  tundra: hex('#a7ad8a'), rock: hex('#9a8670'), highRock: hex('#7d6f66'), snow: hex('#f3f6fa'),
};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// Base colour (0-255 RGB) of a facet whose centre is at lon/lat with height h metres.
export function facetColor(lon, lat, h, land) {
  const P = PALETTE, al = Math.abs(lat);
  const n = fbm(lon * 0.35 + 11, lat * 0.35 + 5);
  if (!land) {
    if ((lat > 74 + n * 6 || lat < -68 - n * 4)) return mix(P.seaIce, P.shelf, 0.15 * n);
    const d = -h;
    if (d < 120) return mix(P.lagoon, P.shelf, smooth(0, 120, d));
    if (d < 1200) return mix(P.shelf, P.ocean, smooth(120, 1200, d));
    if (d < 4500) return mix(P.ocean, P.deep, smooth(1200, 4500, d));
    return mix(P.deep, P.abyss, smooth(4500, 7500, d));
  }
  // Snow line: ~5000 m in the tropics, down to sea level around 78°.
  const snowLine = 5300 * (1 - smooth(25, 78, al)) - 500 * n + 150;
  const icecap = lat < -62 || (lon > -58 && lon < -18 && lat > 60 && h > 500 + n * 500); // Antarctica, Greenland
  if (icecap || h > snowLine) return mix(P.snow, P.seaIce, 0.25 * n);
  const ar = aridity(lon, lat);
  let c;
  if (al < 14) c = mix(P.jungle, P.forest, smooth(6, 14, al) * 0.8 + 0.2 * n);
  else if (al < 35) c = mix(P.forest, P.grass, smooth(14, 30, al));
  else if (al < 50) c = mix(P.grass, P.forest, smooth(40, 50, al) * 0.6 + 0.3 * n);
  else if (al < 64) c = mix(P.forest, P.boreal, smooth(50, 58, al));
  else c = mix(P.boreal, P.tundra, smooth(64, 70, al));
  c = mix(c, P.steppe, smooth(0.25, 0.5, ar) * 0.9);
  c = mix(c, P.desert, smooth(0.5, 0.85, ar));
  if (ar > 0.8 && n > 0.55) c = mix(c, P.sand, 0.5);
  // Mountains: bare rock above the tree line.
  c = mix(c, P.rock, smooth(1700, 3000, h) * 0.85);
  c = mix(c, P.highRock, smooth(3000, 4800, h) * 0.7);
  return c;
}

// ---------- projections ----------
// Equal Earth (Šavrič, Patterson & Jenny 2018): equal-area, rounded sides.
// Patterson cylindrical (Patterson, Šavrič & Jenny 2015): a rectangle about
// 1.75 : 1, close to a 16:9 screen, with less polar stretch than Miller.
// Both return [x, y] in Earth radii with y pointing south (screen order).

const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = Math.sqrt(3) / 2;
function equalEarth(lon, lat) {
  const t = Math.asin(M * Math.sin(lat * D2R)), t2 = t * t, t6 = t2 * t2 * t2;
  const x = (2 * Math.sqrt(3) * lon * D2R * Math.cos(t)) / (3 * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)));
  const y = t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
  return [x, -y];
}
function equalEarthInv(x, y) {
  y = -y;
  let t = y;
  for (let i = 0; i < 12; i++) {
    const t2 = t * t, t6 = t2 * t2 * t2;
    const f = t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2)) - y;
    const df = A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2);
    t -= f / df;
  }
  const t2 = t * t, t6 = t2 * t2 * t2;
  const lon = (3 * x * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2))) / (2 * Math.sqrt(3) * Math.cos(t));
  return [lon / D2R, Math.asin(Math.max(-1, Math.min(1, Math.sin(t) / M))) / D2R];
}

const PK1 = 1.0148, PK2 = 0.23185, PK3 = -0.14499, PK4 = 0.02406;
function patterson(lon, lat) {
  const p = lat * D2R, p2 = p * p;
  return [lon * D2R, -p * (PK1 + p2 * p2 * (PK2 + p2 * (PK3 + PK4 * p2)))];
}
function pattersonInv(x, y) {
  y = Math.max(-1.790857183, Math.min(1.790857183, -y));
  let p = y;
  for (let i = 0; i < 12; i++) {
    const p2 = p * p, p4 = p2 * p2;
    const f = p * (PK1 + p4 * (PK2 + p2 * (PK3 + PK4 * p2))) - y;
    const df = PK1 + p4 * (5 * PK2 + p2 * (7 * PK3 + 9 * PK4 * p2));
    p -= f / df;
  }
  return [x / D2R, p / D2R];
}

export const PROJECTIONS = {
  patterson: { name: 'Patterson', note: 'Rectangle, about 1.75 : 1', fwd: patterson, inv: pattersonInv },
  'equal-earth': { name: 'Equal Earth', note: 'Equal-area, rounded sides', fwd: equalEarth, inv: equalEarthInv },
};
let proj = PROJECTIONS.patterson;
export let projectionId = 'patterson';
export let MAP_W = 0, MAP_H = 0;
export function setProjection(id) {
  proj = PROJECTIONS[id] || PROJECTIONS.patterson;
  projectionId = PROJECTIONS[id] ? id : 'patterson';
  MAP_W = proj.fwd(180, 0)[0] * 2;
  MAP_H = -proj.fwd(0, 90)[1] * 2;
}
export function project(lon, lat) { return proj.fwd(lon, lat); }
export function unproject(x, y) { return proj.inv(x, y); }
setProjection('patterson');

// ---------- the point set ----------

export function toXYZ(lon, lat, r = 1) {
  const cl = Math.cos(lat * D2R);
  return [r * cl * Math.cos(lon * D2R), r * Math.sin(lat * D2R), -r * cl * Math.sin(lon * D2R)];
}
function fromXYZ(x, y, z) {
  const r = Math.hypot(x, y, z);
  return [Math.atan2(-z, x) / D2R, Math.asin(y / r) / D2R];
}

function fibonacci(n, rand, jitter) {
  const pts = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  const spacing = Math.sqrt(4 * Math.PI / n) / D2R;
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    let lat = Math.asin(y) / D2R, lon = ((i * ga) / D2R) % 360 - 180;
    lat += (rand() - 0.5) * spacing * jitter;
    lon += ((rand() - 0.5) * spacing * jitter) / Math.max(0.2, Math.cos(lat * D2R));
    lat = Math.max(-89.5, Math.min(89.5, lat));
    lon = ((lon + 540) % 360) - 180;
    pts.push([lon, lat]);
  }
  return pts;
}

// Base points everywhere, plus a denser set kept only near coastlines (where
// land and water meet within `probe` degrees) so continents keep their shape.
export function makePoints(grid, { base = 7000, coast = 30000, seed = 7 } = {}) {
  const rand = mulberry(seed);
  const pts = fibonacci(base, rand, 0.7);
  const probe = 0.9 * Math.sqrt(41253 / coast);
  for (const [lon, lat] of fibonacci(coast, rand, 0.8)) {
    if (Math.abs(lat) > 84) continue;
    const l = isLand(grid, lon, lat);
    const k = probe / Math.max(0.25, Math.cos(lat * D2R));
    if (isLand(grid, lon + k, lat) !== l || isLand(grid, lon - k, lat) !== l || isLand(grid, lon, lat + probe) !== l || isLand(grid, lon, lat - probe) !== l) pts.push([lon, lat]);
  }
  pts.push([0, 90]); // the north pole, last: sphereTriangles fans the cap from it
  const lon = new Float32Array(pts.length), lat = new Float32Array(pts.length), h = new Float32Array(pts.length);
  pts.forEach(([a, b], i) => { lon[i] = a; lat[i] = b; h[i] = heightAt(grid, a, b); });
  return { n: pts.length, lon, lat, h };
}

// Triangles on the sphere: Delaunay of the stereographic projection from the
// north pole (it preserves circles, so it is the spherical Delaunay), then a
// fan from the pole to the hull closes the cap.
export function sphereTriangles(points) {
  const n = points.n - 1; // all but the pole
  const coords = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    const [x, y, z] = toXYZ(points.lon[i], points.lat[i]);
    // pole at +y
    const d = 1 - y;
    coords[2 * i] = x / d; coords[2 * i + 1] = z / d;
  }
  const del = new Delaunator(coords);
  const tris = Array.from(del.triangles);
  const pole = n;
  const hull = del.hull;
  for (let i = 0; i < hull.length; i++) tris.push(hull[(i + 1) % hull.length], hull[i], pole);
  return { triangles: Uint32Array.from(tris), pole };
}

// Triangles on the flat map: Delaunay of the projected points plus points
// along the map's outline, so the facets fill the whole Equal Earth shape.
export function mapTriangles(points) {
  const outline = mapOutline(96);
  const n = points.n, m = outline.length;
  const coords = new Float64Array((n + m) * 2);
  const ll = new Float32Array((n + m) * 2);
  for (let i = 0; i < n; i++) {
    const [x, y] = project(points.lon[i], points.lat[i]);
    coords[2 * i] = x; coords[2 * i + 1] = y;
    ll[2 * i] = points.lon[i]; ll[2 * i + 1] = points.lat[i];
  }
  outline.forEach(([lon, lat], k) => {
    const [x, y] = project(lon, lat);
    coords[2 * (n + k)] = x; coords[2 * (n + k) + 1] = y;
    ll[2 * (n + k)] = lon; ll[2 * (n + k) + 1] = lat;
  });
  const del = new Delaunator(coords);
  return { coords, ll, triangles: del.triangles, count: n + m };
}

export function mapOutline(steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) pts.push([180, 90 - (180 * i) / steps]);
  for (let i = 1; i < steps; i++) pts.push([180 - (360 * i) / steps, -90]);
  for (let i = 0; i <= steps; i++) pts.push([-180, -90 + (180 * i) / steps]);
  for (let i = 1; i < steps; i++) pts.push([-180 + (360 * i) / steps, 90]);
  return pts;
}

// Colour of one triangle from the lon/lat of its corners (and their heights).
export function triangleColor(grid, lons, lats, hs) {
  let x = 0, y = 0, z = 0;
  for (let k = 0; k < 3; k++) { const v = toXYZ(lons[k], lats[k]); x += v[0]; y += v[1]; z += v[2]; }
  const [lon, lat] = fromXYZ(x, y, z);
  const land = isLand(grid, lon, lat);
  const h = land ? Math.max(20, (hs[0] + hs[1] + hs[2]) / 3) : Math.min(-20, (Math.min(0, hs[0]) + Math.min(0, hs[1]) + Math.min(0, hs[2])) / 3);
  return { color: facetColor(lon, lat, h, land), land, lon, lat };
}

// Lambert shade of a facet, given its normal (unit) and a light from the
// north-west and above, the same in both views.
export const LIGHT = (() => { const v = [-0.45, 0.55, 0.7]; const l = Math.hypot(...v); return v.map((c) => c / l); })();
export function shade(color, ndotl, ambient = 0.62) {
  const k = ambient + (1 - ambient) * Math.max(0, ndotl) * 1.15;
  return [Math.min(255, color[0] * k), Math.min(255, color[1] * k), Math.min(255, color[2] * k)];
}

export function greatCircle(lon1, lat1, lon2, lat2, steps) {
  const a = toXYZ(lon1, lat1), b = toXYZ(lon2, lat2);
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const om = Math.acos(dot), s = Math.sin(om) || 1;
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, ka = Math.sin((1 - t) * om) / s, kb = Math.sin(t * om) / s;
    out.push({ t, xyz: [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb], angle: om });
  }
  return out.map((p) => ({ ...p, ll: fromXYZ(...p.xyz) }));
}

export function distanceKm(lon1, lat1, lon2, lat2) {
  const a = toXYZ(lon1, lat1), b = toXYZ(lon2, lat2);
  return 6371 * Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
}

export async function loadWorld(base = './data/') {
  const [grid, cities] = await Promise.all([
    loadGrid(base + 'elev.bin.gz'),
    fetch(base + 'cities.json').then((r) => r.json()),
  ]);
  const points = makePoints(grid);
  return { grid, cities: cities.places, points };
}
