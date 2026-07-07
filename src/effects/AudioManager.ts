/**
 * Procedural WebAudio layer — no audio assets, everything is synthesized
 * (noise buffers + oscillators), so it adds zero bytes to the bundle and can
 * never 404. All entry points are safe to call before unlock() and no-op
 * gracefully if WebAudio is unavailable (old browsers, some headless runs).
 *
 * Ownership: a single app-level singleton (audio outlives scene objects).
 * unlock() must be called from a user gesture — the splash-screen START tap —
 * or the AudioContext stays suspended and everything stays silent.
 */
export class AudioManager {
  private static instance: AudioManager | null = null;

  static get(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager();
    }
    return AudioManager.instance;
  }

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  // Engine drone nodes (created by startEngine, torn down by stopEngine)
  private engineSource: AudioBufferSourceNode | null = null;
  private engineGain: GainNode | null = null;

  // Threat beeper: the game loop calls setThreat every frame; beeps are
  // self-scheduled against ctx.currentTime (no timers to leak).
  private nextBeepAt: number = 0;

  private constructor() {
    try {
      type AudioContextCtor = new () => AudioContext;
      const Ctor: AudioContextCtor | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();

      // Master chain: gain → soft compressor (keeps stacked explosions from
      // clipping) → destination.
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -12;
      limiter.ratio.value = 8;
      this.master.connect(limiter);
      limiter.connect(this.ctx.destination);

      // One shared 2s white-noise buffer feeds every noise-based sound.
      const rate = this.ctx.sampleRate;
      this.noiseBuffer = this.ctx.createBuffer(1, rate * 2, rate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null; // silent no-op mode
    }
  }

  /** Call from a user gesture (START tap): browsers gate audio on interaction. */
  public unlock(): void {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  // ---------------------------------------------------------------- engine

  /** Low filtered-noise drone; runs until stopEngine(). Idempotent. */
  public startEngine(): void {
    if (!this.ctx || !this.master || !this.noiseBuffer || this.engineSource) return;

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const lowpass = this.ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 110;
    lowpass.Q.value = 0.7;

    const gain = this.ctx.createGain();
    gain.gain.value = 0.0;
    // Fade in over a second so the drone doesn't pop at start
    gain.gain.linearRampToValueAtTime(0.35, this.ctx.currentTime + 1.0);

    // Slow throb so the drone doesn't read as a flat hiss
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 3.1;
    const lfoDepth = this.ctx.createGain();
    lfoDepth.gain.value = 0.06;
    lfo.connect(lfoDepth);
    lfoDepth.connect(gain.gain);
    lfo.start();

    src.connect(lowpass);
    lowpass.connect(gain);
    gain.connect(this.master);
    src.start();

    this.engineSource = src;
    this.engineGain = gain;
  }

  public stopEngine(): void {
    if (!this.ctx || !this.engineSource || !this.engineGain) return;
    const t = this.ctx.currentTime;
    this.engineGain.gain.cancelScheduledValues(t);
    this.engineGain.gain.setValueAtTime(this.engineGain.gain.value, t);
    this.engineGain.gain.linearRampToValueAtTime(0, t + 0.4);
    const src = this.engineSource;
    setTimeout(() => {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }, 500);
    this.engineSource = null;
    this.engineGain = null;
  }

  // ------------------------------------------------------------ one-shots

  /**
   * Explosion boom. `scale` matches ExplosionPool's visual scale (1 = bomb);
   * `distance` is meters from the listener (camera) for 1/d attenuation.
   */
  public explosion(scale: number = 1, distance: number = 0): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const t = this.ctx.currentTime;
    // Reference distance 60u; beyond ~800u it's inaudible by design
    const attenuation = Math.min(1, 60 / (distance + 60));
    const loudness = Math.min(1.2, 0.5 * scale + 0.3) * attenuation;
    if (loudness < 0.01) return;

    // Noise body with a falling lowpass sweep (the "boom" tail)
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(700, t);
    filter.frequency.exponentialRampToValueAtTime(60, t + 1.0);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(loudness, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(t);
    src.stop(t + 1.3);

    // Sub-bass thump under the noise
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(70, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.5);
    const oscGain = this.ctx.createGain();
    oscGain.gain.setValueAtTime(loudness * 0.8, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    osc.connect(oscGain);
    oscGain.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.7);
  }

  /** Short bright pop for a countermeasure volley. */
  public flarePop(): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1800;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(t);
    src.stop(t + 0.2);
  }

  /** Rising filtered-noise swell for a Tomahawk leaving the bay. */
  public launchWhoosh(): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(250, t);
    filter.frequency.exponentialRampToValueAtTime(1600, t + 0.5);
    filter.frequency.exponentialRampToValueAtTime(500, t + 0.9);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(0.5, t + 0.35);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(t);
    src.stop(t + 1.1);
  }

  /** Dull thump when the bomber takes a hit (pairs with the damage flash). */
  public hit(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(95, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.18);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.6, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  // --------------------------------------------------------------- threat

  /**
   * Escalating warning beeper, driven every frame by the game loop.
   * `closeness` is 0 (threat at max alert range) → 1 (on top of the bomber);
   * it compresses the beep interval so the tempo itself reads as distance.
   */
  public setThreat(stage: 'none' | 'inbound' | 'locked', closeness: number): void {
    if (!this.ctx || !this.master || stage === 'none') return;
    const now = this.ctx.currentTime;
    if (now < this.nextBeepAt) return;

    const c = Math.min(1, Math.max(0, closeness));
    const interval = stage === 'locked' ? 0.5 - 0.38 * c : 1.2 - 0.8 * c;
    const freq = stage === 'locked' ? 1250 : 820;
    this.nextBeepAt = now + interval;

    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.09);
  }
}
