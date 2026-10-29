// Parse ../../README.md into data/cities.json: one place per city, with every
// entry (take) on that city. Coordinates come from the table below; a city in
// the README without coordinates fails the build so the map never drops one.
//
//   node map/build/build-cities.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const readme = readFileSync(join(root, 'README.md'), 'utf8');

// [lat, lon] of each city centre (or of the part of the city the sim covers).
const COORDS = {
  'New York': [40.758, -73.9855],
  Abuja: [9.0579, 7.4951],
  Kaduna: [10.5105, 7.4165],
  Bangkok: [13.7367, 100.5608],
  Dubai: [25.1972, 55.2744],
  'Hong Kong': [22.2988, 114.1722],
  Riyadh: [24.7136, 46.6753],
  Shanghai: [31.2397, 121.4998],
  Singapore: [1.2834, 103.8607],
  Taipei: [25.0375, 121.5637],
  Barcelona: [41.3874, 2.1686],
  Berlin: [52.5163, 13.3777],
  Copenhagen: [55.6761, 12.5683],
  'Donostia / San Sebastián': [43.3183, -1.9812],
  Kahramanmaraş: [37.5753, 36.9228],
  Nairobi: [-1.2864, 36.8172],
  Seattle: [47.6062, -122.3321],
  'Zürich': [47.3769, 8.5417],
  Kazan: [55.7963, 49.1088],
  London: [51.5072, -0.1276],
  Madrid: [40.4168, -3.7038],
  Montreux: [46.4312, 6.9107],
  Oslo: [59.9139, 10.7522],
  Seville: [37.3891, -5.9845],
  Terrassa: [41.5632, 2.0089],
  Utrecht: [52.0907, 5.1214],
  Warsaw: [52.2297, 21.0122],
  'Ciudad Obregón': [27.4828, -109.9304],
  'San Francisco': [37.7749, -122.4194],
  Tepic: [21.5042, -104.8946],
  Toronto: [43.6532, -79.3832],
  Uruapan: [19.4167, -102.0633],
  'Buenos Aires': [-34.6037, -58.3816],
};

// Featured screenshots, by the Play link they sit on in the README.
const shots = {};
for (const m of readme.matchAll(/<a href="([^"]+)"><img src="(screenshots\/[^"]+)"/g)) shots[m[1]] = m[2];

const linkRe = /\[([^\]]+)\]\((https?:[^)]+)\)/g;

function parseEntry(line) {
  // - **Name** - [Play](..) · [Source](..) - by [@x](..). Description.
  const m = line.match(/^- \*\*(.+?)\*\*(.*)$/);
  if (!m) return null;
  const title = m[1];
  const rest = m[2];
  const links = {};
  let author = null;
  let authorUrl = null;
  let desc = '';
  for (const p of rest.matchAll(linkRe)) {
    const [, label, url] = p;
    if (['Play', 'Source', 'Tweet'].includes(label) && !links[label.toLowerCase()]) links[label.toLowerCase()] = url;
  }
  const by = rest.match(/ - by \[([^\]]+)\]\(([^)]+)\)\.?\s*(.*)$/);
  if (by) {
    author = by[1];
    authorUrl = by[2];
    desc = by[3];
  } else {
    // No author: the description follows the last link group.
    const tail = rest.replace(/^\s*-\s*/, '').split(/\)\.\s+|\)\s+-\s+/).slice(1).join(' ');
    desc = tail;
  }
  const flags = [];
  desc = desc.replace(/\s*\*\(([^)]+)\)\*\s*/g, (_, f) => (flags.push(f), ' ')).trim();
  desc = desc.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*?([^*]+)\*\*?/g, '$1').replace(/`([^`]+)`/g, '$1');
  return { title, links, author, authorUrl, desc, flags, screenshot: links.play ? shots[links.play] || null : null };
}

const places = new Map();
const remixes = [];
let section = null;
let region = null;
for (const line of readme.split('\n')) {
  const h2 = line.match(/^## (.+)/);
  if (h2) { section = h2[1].trim(); region = null; continue; }
  const h3 = line.match(/^### (.+)/);
  if (h3) { region = h3[1].trim(); continue; }
  if (!line.startsWith('- **')) continue;
  const e = parseEntry(line);
  if (!e) continue;
  if (section === 'The original' || section === 'Cities') {
    // "Taipei, Taiwan (sc0Vu)" -> city Taipei, country Taiwan, tag sc0Vu
    const tagM = e.title.match(/^(.*?)\s*\(([^)]+)\)$/);
    const base = tagM ? tagM[1] : e.title;
    const tag = tagM ? tagM[2] : null;
    const [city, ...countryParts] = base.split(',').map((s) => s.trim());
    const country = countryParts.join(', ') || null;
    const ll = COORDS[city];
    if (!ll) throw new Error(`No coordinates for "${city}" (README line: ${line.slice(0, 80)})`);
    if (!places.has(city)) {
      places.set(city, {
        id: city.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        city, country, region: section === 'The original' ? 'North America' : region,
        lat: ll[0], lon: ll[1], original: section === 'The original', entries: [], remixes: [],
      });
    }
    places.get(city).entries.push({ ...e, tag });
  } else if (section === 'New York remixes') {
    remixes.push(e);
  } else if (section === 'Other maps, games and racing' && /New York/.test(e.desc)) {
    remixes.push(e);
  }
}
const ny = places.get('New York');
ny.remixes = remixes;

const out = [...places.values()];
// Lineage drawn as arcs: every city descends from New York; a README line
// that says "Adapted from ... Slop Singapore" adds that city as a parent too.
for (const p of out) {
  p.parents = p.original ? [] : ['new-york'];
  for (const e of p.entries) {
    const m = e.desc.match(/Adapted from ([^.]+)/i);
    if (!m) continue;
    for (const q of out) if (q !== p && !q.original && m[1].includes(`Slop ${q.city}`)) p.parents.push(q.id);
  }
}

for (const p of out) for (const e of p.entries) if (e.screenshot && !existsSync(join(root, e.screenshot))) e.screenshot = null;

const json = { generated: new Date().toISOString().slice(0, 10), places: out };
writeFileSync(join(here, '..', 'data', 'cities.json'), JSON.stringify(json, null, 1) + '\n');
console.log(`${out.length} cities, ${out.reduce((n, p) => n + p.entries.length, 0)} entries, ${remixes.length} New York remixes`);
