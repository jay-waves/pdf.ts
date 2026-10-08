type ScrollPosition = { left: number; top: number; maxTop: number };

/** Small relative scrolls share one animation; repeated input extends its target. */
export class SmoothScroll {
  private frame = 0;
  private motion: { target: number; time: number } | null = null;

  constructor(
    private readonly read: () => ScrollPosition | null,
    private readonly write: (top: number, position: ScrollPosition) => void,
  ) {}

  move(delta: number) {
    const position = this.read();
    if (!position || !Number.isFinite(delta) || delta === 0) return;
    const remaining = (this.motion?.target ?? position.top) - position.top;
    // Reverse immediately instead of first exhausting the old destination.
    const base = remaining * delta < 0 ? position.top : this.motion?.target ?? position.top;
    const target = Math.min(position.maxTop, Math.max(0, base + delta));
    if (this.motion) this.motion.target = target;
    else this.motion = { target, time: performance.now() };
    if (!this.frame) this.frame = requestAnimationFrame(this.step);
  }

  stop() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.motion = null;
  }

  private step = (time: number) => {
    this.frame = 0;
    const position = this.read();
    const motion = this.motion;
    if (!position || !motion) return this.stop();
    motion.target = Math.min(position.maxTop, Math.max(0, motion.target));
    const distance = motion.target - position.top;
    // Time-based easing keeps the response consistent at different refresh rates.
    const fraction = 1 - Math.exp(-Math.max(0, time - motion.time) / 55);
    motion.time = time;
    if (Math.abs(distance) < 0.5) {
      this.write(motion.target, position);
      this.motion = null;
      return;
    }
    this.write(position.top + distance * fraction, position);
    this.frame = requestAnimationFrame(this.step);
  };
}
