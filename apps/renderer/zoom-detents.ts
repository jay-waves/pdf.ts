const APPROACH = Math.log(1.04);
const CAPTURE = Math.log(1.008);
const RELEASE = Math.log(1.06);
const SUBSTEP = 0.002;

/** Logarithmic distances give every zoom level the same relative feel. */
export class ZoomDetents {
  private position: number;
  private held: number | null = null;
  private escaped: number | null = null;
  private pressure = 0;

  constructor(level: number) {
    this.position = Math.log(level);
  }

  move(delta: number, levels: number[]) {
    const nodes = levels.filter((n) => Number.isFinite(n) && n >= 0.2 && n <= 60)
      .map(Math.log).sort((a, b) => a - b)
      .filter((n, i, all) => i === 0 || n - all[i - 1] > Math.log(1.02));
    if (this.held !== null && !nodes.includes(this.held)) {
      this.held = null;
      this.pressure = 0;
    }
    const count = Math.ceil(Math.abs(delta) / SUBSTEP);
    for (let i = 0; i < count; i++) {
      const step = delta / count;
      if (this.held !== null) {
        this.pressure += step;
        if (Math.abs(this.pressure) <= RELEASE) continue;
        this.position = this.held + this.pressure - Math.sign(this.pressure) * RELEASE;
        this.escaped = this.held;
        this.held = null;
        this.pressure = 0;
        continue;
      }
      if (this.escaped !== null && Math.abs(this.position - this.escaped) > APPROACH) {
        this.escaped = null;
      }
      const node = nodes.find((n) => n !== this.escaped
        && Math.abs(n - this.position) <= APPROACH
        && (Math.abs(n - this.position) <= CAPTURE || (n - this.position) * step > 0));
      if (node !== undefined) {
        if (Math.abs(node - this.position) <= CAPTURE) {
          this.position = node;
          this.held = node;
          this.pressure = step;
        } else {
          this.position += step * (0.35 + 0.65 * Math.abs(node - this.position) / APPROACH);
        }
      } else {
        this.position += step;
      }
      this.position = Math.max(Math.log(0.2), Math.min(Math.log(60), this.position));
    }
    return Math.exp(this.position);
  }
}
