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

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }
}
