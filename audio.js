/* Sandline Siege - original WebAudio music + sound effects (no audio files) */
(function () {
  'use strict';
  const KEY = 'sandline.settings';
  const settings = Object.assign({ music: 0.45, sfx: 0.8, mute: false }, (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } })());
  let ac = null, master, musicBus, sfxBus, started = false, timer = null;

  function save() { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) {} }
  function apply() {
    if (!ac) return;
    const t = ac.currentTime;
    master.gain.setTargetAtTime(settings.mute ? 0 : 1, t, 0.03);
    musicBus.gain.setTargetAtTime(settings.music * 0.55, t, 0.05);
    sfxBus.gain.setTargetAtTime(settings.sfx, t, 0.03);
  }
  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return true; }
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return false; }
    master = ac.createGain(); musicBus = ac.createGain(); sfxBus = ac.createGain();
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    musicBus.connect(master); sfxBus.connect(master); master.connect(comp).connect(ac.destination);
    apply();
    return true;
  }

  // ---------- primitives ----------
  function tone(f, dur, type = 'square', vol = 0.06, slide = null, delay = 0, bus = sfxBus, attack = 0.004) {
    if (!ac) return;
    const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus); o.start(t); o.stop(t + dur + 0.05);
  }
  let noiseBuf = null;
  function getNoise() { if (!noiseBuf) { const n = ac.sampleRate * 1.5; noiseBuf = ac.createBuffer(1, n, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; } return noiseBuf; }
  function noise(dur, vol = 0.08, freq = 1200, delay = 0, type = 'lowpass', bus = sfxBus, q = 0.8, sweepTo = null) {
    if (!ac) return;
    const t = ac.currentTime + delay, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = getNoise(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q; if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(bus); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }

  // ---------- music: a gentle desert loop in D Phrygian dominant (~38 s) ----------
  const BPM = 100, STEP = 60 / BPM / 2; // eighth notes
  const ROOT = 146.83; // D3
  const SCALE = [0, 1, 4, 5, 7, 8, 10, 12, 13, 16];
  const hz = (deg, oct = 0) => ROOT * Math.pow(2, (SCALE[((deg % 7) + 7) % 7] + 12 * (Math.floor(deg / 7) + oct)) / 12);
  // melody in scale degrees (null = rest); 4 phrases x 32 eighths = 128 steps
  const PH_A = [7, null, 8, 7, 6, null, 5, null, 4, 5, 6, null, 5, 4, 2, null, 4, null, 5, 4, 2, 1, 2, null, 0, null, null, null, 2, 1, 0, null];
  const PH_B = [4, null, 4, 5, 6, null, 7, null, 8, 7, 6, 7, 6, 5, 4, null, 5, null, 6, 5, 4, 2, 4, null, 2, 1, 2, null, 1, null, 0, null];
  const PH_C = [9, null, 8, null, 7, 8, 7, 6, 5, null, 6, 5, 4, null, 2, null, 4, 5, 6, null, 5, 4, 2, 1, 0, null, 1, 2, 1, null, 0, null];
  const MELODY = [...PH_A, ...PH_B, ...PH_A.map((d, i) => (d != null && i % 8 === 2 ? d + 1 : d)), ...PH_C];
  const BASS = [0, 0, 0, 0, -3, -3, -2, -2]; // per 16 steps
  // maqsum rhythm per 8 eighths: D T . T D . T .
  const PERC = ['D', 'T', null, 'T', 'D', null, 'T', null];
  let step = 0, nextTime = 0, droneNodes = [];

  function pluck(f, t, vol = 0.09, dur = 0.55) { // oud-like pluck
    const o1 = ac.createOscillator(), o2 = ac.createOscillator(), f1 = ac.createBiquadFilter(), g = ac.createGain();
    o1.type = 'sawtooth'; o2.type = 'triangle'; o1.frequency.setValueAtTime(f * 1.02, t); o1.frequency.exponentialRampToValueAtTime(f, t + 0.04);
    o2.frequency.setValueAtTime(f * 2, t); o2.detune.value = 5;
    f1.type = 'lowpass'; f1.frequency.setValueAtTime(2600, t); f1.frequency.exponentialRampToValueAtTime(500, t + dur); f1.Q.value = 2;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o1.connect(f1); o2.connect(f1); f1.connect(g).connect(musicBus);
    o1.start(t); o2.start(t); o1.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }
  function drum(kind, t) {
    if (kind === 'D') {
      const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine';
      o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.18);
      g.gain.setValueAtTime(0.32, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3); o.connect(g).connect(musicBus); o.start(t); o.stop(t + 0.35);
    } else {
      const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = getNoise();
      f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = 1.4; g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      s.connect(f).connect(g).connect(musicBus); s.start(t, Math.random()); s.stop(t + 0.1);
    }
  }
  function startDrone() {
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 0.5;
    const g = ac.createGain(); g.gain.value = 0.05; lp.connect(g).connect(musicBus);
    for (const [f, type] of [[ROOT / 2, 'sawtooth'], [ROOT * 0.75, 'sawtooth'], [ROOT / 2 * 1.003, 'triangle']]) {
      const o = ac.createOscillator(); o.type = type; o.frequency.value = f; o.connect(lp); o.start(); droneNodes.push(o);
    }
    const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 140; lfo.connect(lg).connect(lp.frequency); lfo.start(); droneNodes.push(lfo);
  }
  function schedule() {
    while (nextTime < ac.currentTime + 0.25) {
      const i = step % MELODY.length, t = nextTime;
      const m = MELODY[i];
      if (m != null) pluck(hz(m, 1), t, 0.075, 0.5 + (i % 4 === 0 ? 0.2 : 0));
      if (i % 16 === 0) pluck(hz(BASS[(i / 16) % BASS.length], 0), t, 0.08, 1.4);
      if (i % 16 === 8) pluck(hz(BASS[Math.floor(i / 16) % BASS.length] + 4, 0), t, 0.05, 0.9);
      const p = PERC[i % 8]; if (p && !(i >= 120 && i % 2)) drum(p, t);
      nextTime += STEP * (i % 2 ? 0.92 : 1.08); // light swing
      step++;
    }
  }
  function startMusic() {
    if (!ac || timer) return;
    nextTime = ac.currentTime + 0.1; step = 0;
    startDrone();
    timer = setInterval(schedule, 60);
  }

  // first user interaction unlocks audio (mobile autoplay rules)
  function unlock() {
    if (!init()) return;
    if (!started) { started = true; startMusic(); }
  }

  // ---------- sound effects ----------
  let lastShot = 0, lastHit = 0;
  const sfx = {
    pickup() { tone(520, 0.06, 'triangle', 0.07, 780); },
    drop() { tone(220, 0.08, 'triangle', 0.12, 140); noise(0.05, 0.08, 900); },
    move() { tone(330, 0.07, 'triangle', 0.09, 460); noise(0.04, 0.05, 1500); },
    swap() { tone(440, 0.07, 'triangle', 0.08, 330); tone(330, 0.07, 'triangle', 0.08, 440, 0.08); noise(0.05, 0.04, 2000, 0.04); },
    merge(tierIdx = 0) {
      const base = 330 * Math.pow(2, Math.min(tierIdx, 12) / 6);
      [1, 1.26, 1.5, 2].forEach((m, i) => tone(base * m, 0.12, 'triangle', 0.08, null, i * 0.05));
      tone(base * 2, 0.35, 'sine', 0.05, base * 4, 0.2); noise(0.2, 0.04, 6000, 0.18, 'highpass');
    },
    shoot(tierIdx = 0) { const n = performance.now(); if (n - lastShot < 35) return; lastShot = n; tone(380 + tierIdx * 40 + Math.random() * 80, 0.09, 'square', 0.025, 160); noise(0.05, 0.03, 2500); },
    hit() { const n = performance.now(); if (n - lastHit < 30) return; lastHit = n; noise(0.07, 0.07, 1800); tone(140, 0.06, 'sine', 0.06, 90); },
    kill() { noise(0.3, 0.14, 900, 0, 'lowpass', sfxBus, 1, 200); tone(300, 0.25, 'sawtooth', 0.04, 60); },
    collect() { [880, 1175, 1568, 2093].forEach((f, i) => tone(f, 0.12, 'sine', 0.07, null, i * 0.05)); noise(0.3, 0.03, 7000, 0.1, 'highpass'); },
    earned() { [659, 988, 1319].forEach((f, i) => tone(f, 0.18, 'triangle', 0.09, null, i * 0.08)); tone(1976, 0.4, 'sine', 0.04, null, 0.24); },
    spray() { noise(0.9, 0.16, 5000, 0, 'highpass', sfxBus, 0.7, 2500); tone(160, 0.6, 'sine', 0.05, 120, 0.1); },
    fire() { noise(0.35, 0.12, 400, 0, 'bandpass', sfxBus, 1, 3000); noise(0.6, 0.25, 700, 0.3); tone(80, 0.5, 'sine', 0.25, 35, 0.3); },
    superc() { for (let i = 0; i < 8; i++) tone(600 * Math.pow(1.12, i), 0.1, 'sine', 0.06, null, i * 0.04); tone(1800, 0.5, 'triangle', 0.04, 2600, 0.32); },
    wall() { noise(0.9, 0.3, 500, 0, 'lowpass', sfxBus, 0.8, 120); tone(70, 0.7, 'sawtooth', 0.1, 30); for (let i = 0; i < 5; i++) noise(0.05, 0.12, 2500, 0.05 + i * 0.09, 'bandpass'); },
    level() { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.16, 'square', 0.035, null, i * 0.08)); tone(1046, 0.6, 'triangle', 0.06, null, 0.42); },
    over() { [392, 349, 311, 262, 196].forEach((f, i) => tone(f, 0.38, 'triangle', 0.1, null, i * 0.24)); noise(1.2, 0.08, 300, 0.2); },
    hatch() { for (let i = 0; i < 3; i++) { noise(0.08, 0.08, 1200, i * 0.07, 'bandpass'); tone(700 + i * 120, 0.06, 'sine', 0.04, 1100, i * 0.07); } },
    bad() { tone(160, 0.14, 'square', 0.04, 120); },
    click() { tone(800, 0.04, 'sine', 0.05); },
  };
  const play = (name, ...a) => { if (!ac || settings.mute) return; try { sfx[name] && sfx[name](...a); } catch (e) {} };

  window.SandAudio = {
    unlock, play, settings,
    set(k, v) { settings[k] = v; save(); apply(); },
    get started() { return started; },
  };
})();
