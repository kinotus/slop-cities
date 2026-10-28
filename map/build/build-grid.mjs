// Bake data/elev.bin.gz: a 1024 x 512 equirectangular grid, one byte per cell
// (row 0 at 90°N, column 0 at 180°W, cell centres). Bytes 0-99 are water,
// 99 - 99 * sqrt(depth / 11000 m); bytes 100-255 are land,
// 100 + 155 * sqrt(height / 8800 m). world.js decodes it. Heights and depths come
// from the AWS Terrain Tiles (Terrarium, zoom 3); which cells are land comes
// from Natural Earth 50m land minus 50m lakes, so the Caspian and the Dead Sea
// still come out as water and land below sea level as land.
//
//   node map/build/build-grid.mjs
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync, gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const cache = join(here, '.cache');
mkdirSync(cache, { recursive: true });

const W = 1024, H = 512, Z = 3;

async function cached(name, url) {
  const p = join(cache, name);
  if (existsSync(p)) return readFileSync(p);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const b = Buffer.from(await r.arrayBuffer());
  writeFileSync(p, b);
  return b;
}

// Minimal PNG decoder: 8-bit RGB or RGBA, not interlaced (what Terrarium serves).
function decodePng(buf) {
  let o = 8, w = 0, h = 0, ch = 0;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString('ascii', o + 4, o + 8);
    const d = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      w = d.readUInt32BE(0); h = d.readUInt32BE(4);
      if (d[8] !== 8 || d[12] !== 0) throw new Error('unsupported PNG');
      ch = { 2: 3, 6: 4 }[d[9]];
      if (!ch) throw new Error('unsupported PNG colour type ' + d[9]);
    } else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride), prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev ? prev[i] : 0, c = prev && i >= ch ? prev[i - ch] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}

// Elevation: stitch the 8 x 8 Web Mercator tiles, then sample them per grid cell.
const N = 1 << Z, T = 256;
const merc = new Float32Array(N * T * N * T);
await Promise.all(Array.from({ length: N * N }, async (_, k) => {
  const x = k % N, y = (k / N) | 0;
  const png = decodePng(await cached(`t${Z}-${x}-${y}.png`, `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`));
  for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) {
    const s = (j * T + i) * png.ch, d = png.data;
    merc[(y * T + j) * N * T + x * T + i] = d[s] * 256 + d[s + 1] + d[s + 2] / 256 - 32768;
  }
}));
const MW = N * T;
function elevAt(lon, lat) {
  lat = Math.max(-85.05, Math.min(85.05, lat));
  const fx = ((lon + 180) / 360) * MW - 0.5;
  const fy = ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * MW - 0.5;
  const x0 = Math.floor(fx), y0 = Math.max(0, Math.min(MW - 2, Math.floor(fy))), tx = fx - x0, ty = Math.max(0, Math.min(1, fy - y0));
  const g = (x, y) => merc[y * MW + ((x % MW) + MW) % MW];
  return (g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx) * (1 - ty) + (g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx) * ty;
}

// Land: even-odd scanline fill of every ring at the grid's cell centres.
function rasterize(geojson, value, mask) {
  const rows = Array.from({ length: H }, () => []);
  for (const f of geojson.features) {
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) {
      const xs = Array.from({ length: H }, () => []);
      for (const ring of poly) for (let i = 0, n = ring.length; i < n - 1; i++) {
        const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
        const r1 = (90 - y1) / 180 * H - 0.5, r2 = (90 - y2) / 180 * H - 0.5;
        const lo = Math.ceil(Math.min(r1, r2)), hi = Math.floor(Math.max(r1, r2) - 1e-9);
        for (let r = Math.max(0, lo); r <= Math.min(H - 1, hi); r++) {
          const t = (r - r1) / (r2 - r1);
          xs[r].push(x1 + (x2 - x1) * t);
        }
      }
      for (let r = 0; r < H; r++) if (xs[r].length) rows[r].push(xs[r].sort((a, b) => a - b));
    }
  }
  for (let r = 0; r < H; r++) for (const xs of rows[r]) for (let k = 0; k + 1 < xs.length; k += 2) {
    const c0 = Math.ceil((xs[k] + 180) / 360 * W - 0.5), c1 = Math.floor((xs[k + 1] + 180) / 360 * W - 0.5);
    for (let c = Math.max(0, c0); c <= Math.min(W - 1, c1); c++) mask[r * W + c] = value;
  }
}

const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
const land = JSON.parse(await cached('ne_50m_land.geojson', NE + 'ne_50m_land.geojson'));
const lakes = JSON.parse(await cached('ne_50m_lakes.geojson', NE + 'ne_50m_lakes.geojson'));
const mask = new Uint8Array(W * H);
rasterize(land, 1, mask);
rasterize(lakes, 0, mask);
// Antarctica's polygon closes along -90°; keep the last rows solid regardless.
for (let r = H - 3; r < H; r++) for (let c = 0; c < W; c++) mask[r * W + c] = 1;

const grid = new Uint8Array(W * H);
let landCells = 0;
for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
  const lat = 90 - (r + 0.5) / H * 180, lon = (c + 0.5) / W * 360 - 180;
  let e = Math.round(elevAt(lon, lat));
  // Above ~85° the Mercator tiles have no data; the Arctic is sea ice over ocean.
  if (lat > 85) e = -3000;
  if (lat < -85) e = 2800;
  const isLand = mask[r * W + c];
  landCells += isLand;
  grid[r * W + c] = isLand
    ? 100 + Math.round(155 * Math.sqrt(Math.min(1, Math.max(0, e) / 8800)))
    : 99 - Math.round(99 * Math.sqrt(Math.min(1, Math.max(0, -e) / 11000)));
}
const outDir = join(here, '..', 'data');
mkdirSync(outDir, { recursive: true });
const gz = gzipSync(Buffer.from(grid), { level: 9 });
writeFileSync(join(outDir, 'elev.bin.gz'), gz);
console.log(`grid ${W}x${H}, land ${(100 * landCells / (W * H)).toFixed(1)}% of cells, ${(gz.length / 1024).toFixed(0)} KB gzipped`);
