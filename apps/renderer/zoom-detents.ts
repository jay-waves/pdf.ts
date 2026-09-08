const MIN_NODE_DISTANCE = Math.log(1.02);
const MIN_POSITION = Math.log(0.2);
const MAX_POSITION = Math.log(60);
const HOLD_MS = 220;

/** Logarithmic distances give every zoom level the same relative feel. */
export class ZoomDetents {
  private position: number;
  private held: number | null = null;
  private holdUntil = 0;

  constructor(level: number) {
    this.position = Math.log(level);
  }

  move(delta: number, levels: number[], now = performance.now()) {
    if (!Number.isFinite(delta) || delta === 0) return Math.exp(this.position);
    const nodes = levels
      .filter((level) => Number.isFinite(level) && level >= 0.2 && level <= 60)
      .map(Math.log)
      .sort((a, b) => a - b)
      .filter((node, i, all) => i === 0 || node - all[i - 1] > MIN_NODE_DISTANCE);

    if (this.held !== null && !nodes.includes(this.held)) {
      this.held = null;
    }
    let released: number | null = null;
    if (this.held !== null) {
      // Discard input during the pause to avoid a jump on release.
      if (now < this.holdUntil) return Math.exp(this.position);
      released = this.held;
      this.held = null;
    }

    // Stop at the first node crossed, regardless of input speed or frame size.
    const ordered = delta > 0 ? nodes : nodes.reverse();
    const crossed = ordered.find((node) => node !== released
      && (node - this.position) * delta > 0
      && Math.abs(node - this.position) <= Math.abs(delta));
    if (crossed !== undefined) {
      this.position = crossed;
      this.held = crossed;
      this.holdUntil = now + HOLD_MS;
    } else {
      this.position = Math.max(MIN_POSITION, Math.min(MAX_POSITION, this.position + delta));
    }
    return Math.exp(this.position);
  }
}
