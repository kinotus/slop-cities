// App shell: city list, search, city card, Map / Globe / Compare modes, and
// the wiring that keeps selection (and, in Compare, the view) in sync.
import { loadWorld, distanceKm } from './world.js';
import { createMap2D } from './map2d.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const bus = {
  h: {},
  on(t, f) { (this.h[t] ||= []).push(f); },
  emit(t, d) { for (const f of this.h[t] || []) f(d); },
};

const world = await loadWorld('./data/');
const places = world.cities;
const byId = new Map(places.map((p) => [p.id, p]));
const ny = byId.get('new-york');

const map = createMap2D($('#stage-2d'), world, bus);
let globe = null, globePromise = null;
function ensureGlobe() {
  if (!globePromise) {
    globePromise = import('./globe3d.js')
      .then(({ createGlobe3D }) => createGlobe3D($('#stage-3d'), world, bus))
      .then((g) => {
        globe = g;
        $('#loading-3d').hidden = true;
        g.setOptions(currentOpts());
        g.setSelected(state.selected);
        if (state.selected) { const p = byId.get(state.selected); g.flyTo(p.lon, p.lat, 3.5, 0); }
        else if (state.mode === 'compare' && $('#opt-link').checked) g.setView(map.getView());
        return g;
      })
      .catch((e) => { $('#loading-3d').textContent = 'The globe needs WebGL: ' + e.message; throw e; });
  }
  return globePromise;
}

const state = { mode: '2d', selected: null, hovered: null, query: '' };

// ---------- stats + list ----------
const takes = places.reduce((n, p) => n + p.entries.length, 0);
const countries = new Set(places.map((p) => p.country || p.city)).size;
const far = places.filter((p) => !p.original).reduce((a, p) => (distanceKm(ny.lon, ny.lat, p.lon, p.lat) > distanceKm(ny.lon, ny.lat, a.lon, a.lat) ? p : a));
$('#stats').innerHTML = `<b>${places.length}</b> cities · <b>${takes}</b> takes · <b>${countries}</b> countries · <b>${ny.remixes.length}</b> New York remixes<br><span>Farthest from New York: ${esc(far.city)}, ${Math.round(distanceKm(ny.lon, ny.lat, far.lon, far.lat)).toLocaleString()} km</span>`;

const REGIONS = ['North America', 'South America', 'Europe', 'Africa', 'Asia'];
function renderList() {
  const q = state.query.trim().toLowerCase();
  const match = (p) => !q || [p.city, p.country, p.region, ...p.entries.flatMap((e) => [e.author, e.tag, e.desc])].some((s) => s && s.toLowerCase().includes(q));
  let html = '';
  for (const r of REGIONS) {
    const items = places.filter((p) => p.region === r && match(p)).sort((a, b) => (b.original - a.original) || a.city.localeCompare(b.city));
    if (!items.length) continue;
    html += `<h3>${esc(r)} <span>${items.length}</span></h3><ul>`;
    for (const p of items) {
      const n = p.entries.length;
      html += `<li><button data-id="${p.id}" class="${p.id === state.selected ? 'on' : ''}${p.original ? ' original' : ''}">
        <span class="nm">${esc(p.city)}</span><span class="ct">${esc(p.country || '')}</span>${n > 1 ? `<span class="n" title="${n} takes">${n}</span>` : ''}${p.original ? '<span class="tagline">the original</span>' : ''}
      </button></li>`;
    }
    html += '</ul>';
  }
  $('#list').innerHTML = html || '<p class="none">No city matches.</p>';
}
renderList();
$('#list').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-id]');
  if (b) bus.emit('select', { id: b.dataset.id, source: 'list' });
});
$('#list').addEventListener('pointerover', (e) => {
  const b = e.target.closest('button[data-id]');
  bus.emit('hover', { id: b ? b.dataset.id : null, source: 'list' });
});
$('#list').addEventListener('pointerleave', () => bus.emit('hover', { id: null, source: 'list' }));
$('#search').addEventListener('input', (e) => { state.query = e.target.value; renderList(); });
$('#search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { const b = $('#list button[data-id]'); if (b) bus.emit('select', { id: b.dataset.id, source: 'list' }); }
  if (e.key === 'Escape') { e.target.value = ''; state.query = ''; renderList(); e.target.blur(); }
});

// ---------- card ----------
function linkBtns(l) {
  return [['play', 'Play'], ['source', 'Source'], ['tweet', 'Tweet']].filter(([k]) => l[k]).map(([k, t]) => `<a class="btn ${k}" href="${esc(l[k])}" target="_blank" rel="noopener">${t}</a>`).join('');
}
function renderCard() {
  const p = byId.get(state.selected);
  const card = $('#card');
  if (!p) { card.hidden = true; return; }
  const parents = p.parents.map((id) => byId.get(id));
  const lineage = p.original
    ? `The original. ${places.length - 1} cities and ${ny.remixes.length} remixes descend from it.`
    : `Remixed from ${parents.map((q) => `<a href="#" data-id="${q.id}">Slop ${esc(q.city)}</a>`).join(' and ')} · ${Math.round(distanceKm(ny.lon, ny.lat, p.lon, p.lat)).toLocaleString()} km from New York`;
  const children = places.filter((q) => q.parents.includes(p.id) && p.id !== 'new-york');
  const shot = p.entries.find((e) => e.screenshot);
  card.innerHTML = `
    <button class="close" aria-label="Close">×</button>
    ${shot ? `<a class="shot" href="${esc(shot.links.play)}" target="_blank" rel="noopener"><img src="../${esc(shot.screenshot)}" alt="${esc(p.city)} screenshot" loading="lazy"></a>` : ''}
    <header><h2>${esc(p.city)}</h2><p>${esc([p.country, p.region].filter(Boolean).join(' · '))}</p></header>
    <p class="lineage">${lineage}${children.length ? `<br>Inspired ${children.map((q) => `<a href="#" data-id="${q.id}">${esc(q.city)}</a>`).join(', ')}` : ''}</p>
    <ul class="takes">${p.entries.map((e) => `
      <li>
        <div class="who">${e.tag ? `<b>${esc(e.tag)}</b> · ` : ''}${e.author ? `by <a href="${esc(e.authorUrl)}" target="_blank" rel="noopener">${esc(e.author)}</a>` : '<i>unknown author</i>'}${e.flags.map((f) => ` <span class="flag">${esc(f)}</span>`).join('')}</div>
        ${e.desc ? `<p>${esc(e.desc)}</p>` : ''}
        <div class="links">${linkBtns(e.links)}</div>
      </li>`).join('')}
    </ul>
    ${p.remixes.length ? `<h4>New York remixes</h4><ul class="takes remixes">${p.remixes.map((e) => `
      <li><div class="who"><b>${esc(e.title)}</b>${e.author ? ` · by <a href="${esc(e.authorUrl)}" target="_blank" rel="noopener">${esc(e.author)}</a>` : ''}</div>${e.desc ? `<p>${esc(e.desc)}</p>` : ''}<div class="links">${linkBtns(e.links)}</div></li>`).join('')}</ul>` : ''}`;
  card.hidden = false;
  card.scrollTop = 0;
}
$('#card').addEventListener('click', (e) => {
  if (e.target.closest('.close')) { bus.emit('select', { id: null, source: 'card' }); return; }
  const a = e.target.closest('a[data-id]');
  if (a) { e.preventDefault(); bus.emit('select', { id: a.dataset.id, source: 'card' }); }
});

// ---------- selection ----------
bus.on('select', ({ id, source }) => {
  if (id === state.selected && id) { focusSelected(source); return; }
  state.selected = id;
  map.setSelected(id);
  globe?.setSelected(id);
  renderCard();
  for (const b of document.querySelectorAll('#list button[data-id]')) b.classList.toggle('on', b.dataset.id === id);
  document.querySelector(`#list button[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  if (id) focusSelected(source);
  writeHash();
  if (source !== 'tour') stopTour();
});
function focusSelected(source) {
  const p = byId.get(state.selected);
  if (!p) return;
  const linked = state.mode === 'compare' && $('#opt-link').checked;
  // Linked: fly one view and let the link carry the other along.
  const lead = linked ? (source === '2d' ? 'map' : 'globe') : 'both';
  if (lead !== 'globe' && state.mode !== '3d') map.flyTo(p.lon, p.lat, Math.max(map.getView().zoom, p.region === 'Europe' ? 5 : 3.5), 800, matchMedia('(max-width: 820px)').matches && state.mode === '2d' ? innerHeight * 0.2 : 0);
  if (lead !== 'map' && state.mode !== '2d') ensureGlobe().then((g) => g.flyTo(p.lon, p.lat, Math.min(6, Math.max(g.getView().zoom, 1.5)), 1300));
}

bus.on('hover', ({ id }) => {
  if (id === state.hovered) return;
  state.hovered = id;
  map.setHovered(id);
  globe?.setHovered(id);
  for (const b of document.querySelectorAll('#list button[data-id]')) b.classList.toggle('hover', b.dataset.id === id);
});

// Compare: keep the two cameras looking at the same place.
bus.on('view', (v) => {
  if (state.mode !== 'compare' || !$('#opt-link').checked) return;
  if (v.source === '2d') globe?.setView(v);
  else map.setView(v);
});

// ---------- modes ----------
function setMode(mode) {
  state.mode = mode;
  document.body.className = 'mode-' + mode;
  for (const b of document.querySelectorAll('.modes button')) b.setAttribute('aria-selected', b.dataset.mode === mode);
  if (mode !== '2d') ensureGlobe().then((g) => { g.resize(); g.setRunning(true); if (mode === 'compare' && $('#opt-link').checked && !state.selected) g.setView(map.getView()); });
  else globe?.setRunning(false);
  requestAnimationFrame(() => map.resize());
  writeHash();
}
for (const b of document.querySelectorAll('.modes button')) b.addEventListener('click', () => setMode(b.dataset.mode));

function currentOpts() {
  return { arcs: $('#opt-arcs').checked, labels: $('#opt-labels').checked, clouds: $('#opt-clouds').checked };
}
for (const id of ['opt-arcs', 'opt-labels', 'opt-clouds']) $('#' + id).addEventListener('change', () => { map.setOptions(currentOpts()); globe?.setOptions(currentOpts()); });
$('#opt-link').addEventListener('change', (e) => { if (e.target.checked) globe?.setView(map.getView()); });

for (const z of document.querySelectorAll('.zoom button')) z.addEventListener('click', () => {
  const v = z.closest('.view').classList.contains('view-2d') ? map : globe;
  if (!v) return;
  if (z.dataset.z === 'reset') v.reset(); else v.zoomBy(z.dataset.z === 'in' ? 1.8 : 1 / 1.8);
});

// ---------- tour ----------
let tourTimer = 0;
const tourOrder = [ny, ...places.filter((p) => !p.original).sort((a, b) => a.lon - b.lon)];
function stopTour() { clearInterval(tourTimer); tourTimer = 0; $('#tour').setAttribute('aria-pressed', 'false'); $('#tour').textContent = '▶ Tour'; }
$('#tour').addEventListener('click', () => {
  if (tourTimer) { stopTour(); return; }
  let i = Math.max(0, tourOrder.findIndex((p) => p.id === state.selected));
  const next = () => { bus.emit('select', { id: tourOrder[i % tourOrder.length].id, source: 'tour' }); i++; };
  next();
  tourTimer = setInterval(next, 3800);
  $('#tour').setAttribute('aria-pressed', 'true');
  $('#tour').textContent = '■ Stop';
});

// ---------- keyboard, panel, hash ----------
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input')) return;
  if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
  else if (e.key === 'Escape') bus.emit('select', { id: null, source: 'key' });
  else if (e.key === '1') setMode('2d');
  else if (e.key === '2') setMode('3d');
  else if (e.key === '3') setMode('compare');
});
$('#panel-handle').addEventListener('click', () => $('#panel').classList.toggle('collapsed'));

function writeHash() {
  const h = new URLSearchParams();
  if (state.mode !== '2d') h.set('view', state.mode === '3d' ? 'globe' : 'compare');
  if (state.selected) h.set('city', state.selected);
  const s = h.toString();
  history.replaceState(null, '', s ? '#' + s : location.pathname + location.search);
}
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const v = h.get('view');
  setMode(v === 'globe' ? '3d' : v === 'compare' ? 'compare' : '2d');
  const c = h.get('city');
  if (c && byId.has(c)) bus.emit('select', { id: c, source: 'hash' });
}
readHash();
window.addEventListener('hashchange', readHash);

if (matchMedia('(max-width: 820px)').matches) $('#panel').classList.add('collapsed');
bus.on('select', ({ id }) => { if (id && matchMedia('(max-width: 820px)').matches) $('#panel').classList.add('collapsed'); });
$('#boot').remove();
// For checks and the console.
window.slopMap = { world, map, get globe() { return globe; }, bus, state, setMode, ensureGlobe };
