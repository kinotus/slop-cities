// The swoosh as the map flies to a city, made with Web Audio: noise through
// a band-pass that rises and falls with the camera's ease-in-out, a low rush
// of air under it, and a pan across the stereo field in the direction of
// travel. A short hop gives a soft breath, a flight halfway round the world a
// full swoosh. It has its own audio context, so the music's fade-outs and
// pauses don't cut it off.

export function createSfx() {
  let ctx = null;
  let out = null;
  let noise = null;

  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    out = ctx.createGain();
    out.gain.value = 0.9;
    out.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    // Pink-ish noise (a running average of white), softer than plain hiss.
    let b = 0;
    for (let i = 0; i < len; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 6; }
  }

  // The loudness over the flight: a smooth bell that swells to its top a little
  // before halfway, where the camera is fastest, and eases out as it lands, so
  // the sound is heard all the way through and not only at its peak.
  function bell(top) {
    const n = 64, c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const w = u < 0.45 ? u / 0.45 : (1 - u) / 0.55; // 0 -> 1 -> 0
      c[i] = top * w * w * (3 - 2 * w); // smoothstep on each side
    }
    return c;
  }

  // ms: how long the flight lasts; amount: 0 to 1, how far it goes; pan: -1 west to 1 east.
  function swoosh({ ms = 1200, amount = 0.6, pan = 0 } = {}) {
    if (!ctx) build();
    if (ctx.state !== 'running') ctx.resume();
    const t = ctx.currentTime + 0.01;
    const dur = Math.max(0.35, ms / 1000);
    const peak = t + dur * 0.45; // the camera is fastest a little before halfway
    const end = t + dur;
    const a = Math.max(0.3, Math.min(1, amount));

    const layer = (type, lo, hi, q, vol) => {
      const s = ctx.createBufferSource();
      s.buffer = noise;
      s.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.Q.value = q;
      f.frequency.setValueAtTime(lo, t);
      f.frequency.exponentialRampToValueAtTime(lo + (hi - lo) * a, peak);
      f.frequency.exponentialRampToValueAtTime(lo * 0.8, end);
      const g = ctx.createGain();
      g.gain.setValueCurveAtTime(bell(vol * a), t, dur + 0.15);
      const p = ctx.createStereoPanner();
      p.pan.setValueAtTime(-0.6 * pan, t);
      p.pan.linearRampToValueAtTime(0.6 * pan, end);
      s.connect(f).connect(g).connect(p).connect(out);
      s.start(t, Math.random());
      s.stop(end + 0.3);
    };
    layer('bandpass', 450, 2800, 1.2, 0.34); // the swoosh
    layer('lowpass', 140, 600, 0.7, 0.38); // the rush of air under it
  }

  return { swoosh };
}
