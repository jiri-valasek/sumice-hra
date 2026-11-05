// Syntetizovaný zvuk motoru a houkačky (Web Audio, žádné soubory)
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 600;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.filter.connect(this.engineGain).connect(this.master);

    this.osc1 = ctx.createOscillator();
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'triangle';
    this.osc1.connect(this.filter);
    const g2 = ctx.createGain(); g2.gain.value = 0.6;
    this.osc2.connect(g2).connect(this.filter);
    this.osc1.start(); this.osc2.start();
  }

  setEngine(cfg, speedRatio, throttle) {
    if (!this.ctx) return;
    if (!cfg) { this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1); return; }
    const t = this.ctx.currentTime;
    this.osc1.type = cfg.type;
    const f = cfg.base + cfg.range * Math.min(1.2, Math.abs(speedRatio)) + (throttle ? 12 : 0);
    this.osc1.frequency.setTargetAtTime(f, t, 0.08);
    this.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.08);
    this.filter.frequency.setTargetAtTime(350 + f * 3 + (throttle ? 400 : 0), t, 0.1);
    this.engineGain.gain.setTargetAtTime(this.muted ? 0 : 0.10 + (throttle ? 0.07 : 0), t, 0.1);
  }

  horn(low) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.25, t + 0.02);
    g.gain.setValueAtTime(0.25, t + 0.45);
    g.gain.linearRampToValueAtTime(0, t + 0.55);
    g.connect(this.master);
    for (const f of low ? [220, 277] : [440, 554]) {
      const o = ctx.createOscillator();
      o.type = 'square'; o.frequency.value = f;
      const og = ctx.createGain(); og.gain.value = 0.3;
      o.connect(og).connect(g);
      o.start(t); o.stop(t + 0.6);
    }
  }

  bump(strength) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.15, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = 0.5 * strength;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }

  splash(strength) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.15));
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.value = 0.6 * strength;
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }

  trainHorn(dist) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const vol = Math.max(0.03, Math.min(0.3, 30 / (dist + 20)));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.05);
    g.gain.setValueAtTime(vol, t + 1.1);
    g.gain.linearRampToValueAtTime(0, t + 1.4);
    g.connect(this.master);
    for (const f of [311, 370]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
      o.connect(lp).connect(g); o.start(t); o.stop(t + 1.5);
    }
  }

  click() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(660, t); o.frequency.exponentialRampToValueAtTime(990, t + 0.08);
    g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.13);
  }

  thud() { this.bump(1); this.bump(0.8); }

  fanfare() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = f;
      g.gain.setValueAtTime(0, t + i * 0.12); g.gain.linearRampToValueAtTime(0.12, t + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + (i === 3 ? 0.6 : 0.2));
      o.connect(g).connect(this.master); o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.7);
    });
  }

  chainsaw(on) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (on && !this.saw && !this.muted) {
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = 120; o2.type = 'square'; o2.frequency.value = 241;
      f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 0.8;
      g.gain.value = 0;
      g.gain.linearRampToValueAtTime(0.22, t + 0.1);
      o.frequency.linearRampToValueAtTime(190, t + 0.3);
      o.connect(f); o2.connect(f); f.connect(g).connect(this.master);
      o.start(); o2.start();
      this.saw = { o, o2, g };
    } else if (!on && this.saw) {
      const { o, o2, g } = this.saw;
      g.gain.linearRampToValueAtTime(0, t + 0.15);
      o.stop(t + 0.2); o2.stop(t + 0.2);
      this.saw = null;
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }
}
