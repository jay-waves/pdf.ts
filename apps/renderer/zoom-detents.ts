const RELEASE = Math.log(1.06);

/** Logarithmic distances give every zoom level the same relative feel. */
export class ZoomDetents {
  private position: number;
  private held: number | null = null;
  private pressure = 0;

  constructor(level: number) {
    this.position = Math.log(level);
  }

  move(delta: number, levels: number[]) {
    if (!Number.isFinite(delta) || delta === 0) return Math.exp(this.position);
    const nodes = levels.filter((n) => Number.isFinite(n) && n >= 0.2 && n <= 60)
      .map(Math.log).sort((a, b) => a - b)
      .filter((n, i, all) => i === 0 || n - all[i - 1] > Math.log(1.02));
    if (this.held !== null && !nodes.includes(this.held)) {
      this.held = null;
      this.pressure = 0;
    }
    let released: number | null = null;
    if (this.held !== null) {
      this.pressure += delta;
      if (Math.abs(this.pressure) <= RELEASE) return Math.exp(this.position);
      delta = this.pressure - Math.sign(this.pressure) * RELEASE;
      released = this.held;
      this.held = null;
      this.pressure = 0;
    }

    // Stop at the first node crossed, regardless of input speed or frame size.
    const ordered = delta > 0 ? nodes : nodes.reverse();
    const crossed = ordered.find((node) => node !== released
      && (node - this.position) * delta >= 0
      && Math.abs(node - this.position) <= Math.abs(delta));
    if (crossed !== undefined) {
      this.position = crossed;
      this.held = crossed;
      this.pressure = 0;
    } else {
      this.position = Math.max(Math.log(0.2), Math.min(Math.log(60), this.position + delta));
    }
    return Math.exp(this.position);
  }
}
