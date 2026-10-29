// Generative lo-fi for the map, made with Web Audio at run time: no audio
// files, nothing to license. A slow ii-V-I-vi in F on a soft electric piano,
// a round bass, brushed drums on a lazy swing, vinyl crackle and a little
// tape wobble, all through one warm low-pass. It never plays the same four
// bars twice in a row: the comping, the fills and the melody notes are drawn
// at random from the chord each bar.

const BPM = 72;
const SWING = 0.6; // where the off-beat eighth falls, as a share of the beat
const BEAT = 60 / BPM;

// MIDI notes. Each bar is one chord: a left-hand voicing, the bass root, and
// the notes a melody may take over it.
const BARS = [
  { name: 'Gm9', chord: [55, 58, 62, 65, 69], root: 43, scale: [67, 70, 72, 74, 77, 79] },
  { name: 'C13', chord: [52, 58, 62, 64, 69], root: 36, scale: [64, 67, 69, 70, 72, 74, 76] },
  { name: 'Fmaj9', chord: [53, 57, 60, 64, 67], root: 41, scale: [65, 67, 69, 72, 74, 76, 79] },
  { name: 'Dm9', chord: [50, 53, 57, 60, 64], root: 38, scale: [62, 64, 65, 69, 72, 74, 77] },
];

const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const rnd = (a, b) => a + Math.random() * (b - a);
const chance = (p) => Math.random() < p;

export function createMusic() {
  let ctx = null;
  let nodes = null;
  let timer = 0;
  let nextTime = 0; // when the next eighth note starts
  let step = 0; // eighth notes since the start
  let playing = false;

  function noiseBuffer(seconds, fill) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = fill(i, len);
    return buf;
  }

  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const master = ctx.createGain();
    master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    const warm = ctx.createBiquadFilter(); // the whole mix through a soft low-pass
    warm.type = 'lowpass';
    warm.frequency.value = 3800;
    warm.Q.value = 0.4;
    // Tape wobble: a short delay whose time drifts slowly bends the pitch of
    // the whole mix a few cents, like a worn cassette.
    const wow = ctx.createDelay(0.05);
    wow.delayTime.value = 0.012;
    const wowLfo = ctx.createOscillator();
    wowLfo.frequency.value = 0.4;
    const wowDepth = ctx.createGain();
    wowDepth.gain.value = 0.0012;
    wowLfo.connect(wowDepth).connect(wow.delayTime);
    wowLfo.start();
    warm.connect(wow).connect(comp).connect(master).connect(ctx.destination);

    // A short room: decaying noise as an impulse response.
    const verb = ctx.createConvolver();
    verb.buffer = noiseBuffer(2.4, (i, n) => (Math.random() * 2 - 1) * (1 - i / n) ** 3);
    const verbIn = ctx.createGain();
    verbIn.gain.value = 0.35;
    verbIn.connect(verb).connect(warm);

    const bus = (gain, send = 0) => {
      const g = ctx.createGain();
      g.gain.value = gain;
      g.connect(warm);
      if (send) { const s = ctx.createGain(); s.gain.value = send; g.connect(s).connect(verbIn); }
      return g;
    };

    // Vinyl: a quiet hiss and sparse pops, looped.
    const vinyl = ctx.createBufferSource();
    vinyl.buffer = noiseBuffer(4, () => (chance(0.00045) ? rnd(-1, 1) : 0) + rnd(-1, 1) * 0.012);
    vinyl.loop = true;
    const vinylTone = ctx.createBiquadFilter();
    vinylTone.type = 'bandpass';
    vinylTone.frequency.value = 2400;
    vinylTone.Q.value = 0.6;
    const vinylGain = ctx.createGain();
    vinylGain.gain.value = 0.22;
    vinyl.connect(vinylTone).connect(vinylGain).connect(warm);
    vinyl.start();

    nodes = {
      master,
      keys: bus(0.16, 0.5),
      lead: bus(0.09, 0.8),
      bass: bus(0.34),
      drums: bus(0.5, 0.12),
      noise: noiseBuffer(1, () => rnd(-1, 1)),
    };
  }

  // ---------- voices ----------
  function epiano(midi, t, dur, vel, out = nodes.keys) {
    const f = hz(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.012);
    g.gain.exponentialRampToValueAtTime(vel * 0.35, t + 0.5);
    g.gain.setTargetAtTime(0.0001, t + dur, 0.35);
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.setValueAtTime(2600, t);
    tone.frequency.exponentialRampToValueAtTime(900, t + 1.2);
    tone.connect(g).connect(out);
    // A sine body, a quiet bell partial an octave and a fifth up that fades fast.
    for (const [mult, amp, type, decay] of [[1, 1, 'sine', 0], [2, 0.18, 'triangle', 0], [3, 0.12, 'sine', 0.15]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * mult;
      o.detune.value = rnd(-4, 4);
      const a = ctx.createGain();
      a.gain.setValueAtTime(amp, t);
      if (decay) a.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(a).connect(tone);
      o.start(t);
      o.stop(t + dur + 2);
    }
  }

  function bass(midi, t, dur, vel) {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = hz(midi);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.02);
    g.gain.setTargetAtTime(vel * 0.6, t + 0.05, 0.3);
    g.gain.setTargetAtTime(0.0001, t + dur, 0.08);
    o.connect(lp).connect(g).connect(nodes.bass);
    o.start(t);
    o.stop(t + dur + 0.6);
  }

  function kick(t, vel) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(nodes.drums);
    o.start(t);
    o.stop(t + 0.4);
  }

  function noiseHit(t, vel, type, freq, q, decay) {
    const s = ctx.createBufferSource();
    s.buffer = nodes.noise;
    s.playbackRate.value = rnd(0.9, 1.1);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    s.connect(f).connect(g).connect(nodes.drums);
    s.start(t, rnd(0, 0.5));
    s.stop(t + decay + 0.05);
  }
  const snare = (t, vel) => { noiseHit(t, vel, 'bandpass', 1700, 0.8, 0.22); kickTone(t, vel * 0.25, 190); };
  const hat = (t, vel) => noiseHit(t, vel, 'highpass', 7500, 0.7, 0.05);
  function kickTone(t, vel, f) {
    const o = ctx.createOscillator();
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(g).connect(nodes.drums);
    o.start(t);
    o.stop(t + 0.12);
  }

  // ---------- the sequencer ----------
  // One step is an eighth note; eight to a bar. Off-beats are pushed late for the swing.
  function playStep(s, t) {
    const bar = BARS[Math.floor(s / 8) % BARS.length];
    const i = s % 8; // eighth within the bar
    const beat = i >> 1;
    const off = i % 2 === 1;

    // Drums: kick on 1 and sometimes the and-of-3, snare on 2 and 4, soft hats.
    if (i === 0) kick(t, 0.9);
    if (i === 5 && chance(0.55)) kick(t, 0.6);
    if (i === 7 && chance(0.15)) kick(t, 0.45);
    if (!off && (beat === 1 || beat === 3)) snare(t, 0.28);
    if (chance(off ? 0.75 : 0.95)) hat(t, off ? rnd(0.04, 0.08) : rnd(0.08, 0.12));

    // Keys: the chord on the downbeat, sometimes again on the and-of-2.
    const barDur = BEAT * 4;
    if (i === 0) for (const [k, m] of bar.chord.entries()) epiano(m, t + k * rnd(0.004, 0.012), barDur * 0.9, rnd(0.5, 0.65));
    if (i === 3 && chance(0.4)) for (const m of bar.chord.slice(1)) epiano(m, t, BEAT * 1.2, 0.32);

    // Bass: the root on 1, the fifth or a lower root on 3, a pickup now and then.
    if (i === 0) bass(bar.root, t, BEAT * 1.8, 0.9);
    if (i === 4) bass(chance(0.5) ? bar.root + 7 : bar.root, t, BEAT * 1.4, 0.7);
    if (i === 7 && chance(0.35)) bass(BARS[(Math.floor(s / 8) + 1) % BARS.length].root - 1, t, BEAT * 0.4, 0.5);

    // Melody: a few lazy notes a bar, more likely on the beat.
    if (chance(off ? 0.12 : 0.22)) {
      const m = bar.scale[Math.floor(Math.random() * bar.scale.length)];
      epiano(m + 12, t, BEAT * rnd(0.8, 2), rnd(0.35, 0.55), nodes.lead);
    }
  }

  function schedule() {
    while (nextTime < ctx.currentTime + 0.25) {
      playStep(step, nextTime);
      const off = step % 2 === 1;
      // On beat -> off beat takes SWING of a beat; off beat -> next beat takes the rest.
      nextTime += BEAT * (off ? 1 - SWING : SWING);
      step++;
    }
  }

  async function start() {
    if (playing) return;
    if (!ctx) build();
    await ctx.resume();
    playing = true;
    nextTime = ctx.currentTime + 0.1;
    step = 0;
    nodes.master.gain.cancelScheduledValues(ctx.currentTime);
    nodes.master.gain.setValueAtTime(nodes.master.gain.value, ctx.currentTime);
    nodes.master.gain.linearRampToValueAtTime(0.8, ctx.currentTime + 2.5);
    timer = setInterval(schedule, 50);
    schedule();
  }

  function stop() {
    if (!playing) return;
    playing = false;
    clearInterval(timer);
    const t = ctx.currentTime;
    nodes.master.gain.cancelScheduledValues(t);
    nodes.master.gain.setValueAtTime(nodes.master.gain.value, t);
    nodes.master.gain.linearRampToValueAtTime(0, t + 1.2);
    setTimeout(() => { if (!playing) ctx.suspend(); }, 1400);
  }

  // Whether the browser lets sound start now, before any click or key. Desktop
  // Chrome and Edge do on a site you've played sound on before; Firefox can be
  // set to; Safari and every iPhone wait for a tap.
  function mayAutoplay() {
    if (navigator.getAutoplayPolicy) return navigator.getAutoplayPolicy('audiocontext') === 'allowed';
    if (!ctx) build();
    return ctx.state === 'running';
  }

  // Ask the browser for sound from inside a click or tap, and call back once it
  // is granted. iOS grants it on some events (touchend, click) and not others
  // (pointerdown), so the caller asks on each one until this fires.
  function unlock(onRunning) {
    if (!ctx) build();
    if (ctx.state === 'running') { onRunning(); return; }
    ctx.addEventListener('statechange', function once() {
      if (ctx.state !== 'running') return;
      ctx.removeEventListener('statechange', once);
      onRunning();
    });
    ctx.resume();
  }

  return { start, stop, mayAutoplay, unlock, toggle: () => (playing ? stop() : start()), get playing() { return playing; } };
}
