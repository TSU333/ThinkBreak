type StabilitySnapshot = {
  changed: boolean;
  hash: string;
  length: number;
};

export class TextStabilityTracker {
  private lastHash = "";
  private lastLength = 0;
  private lastChangedAt = 0;

  update(text: string, now = Date.now()): StabilitySnapshot {
    const hash = this.hashText(text);
    const length = text.length;
    const changed = hash !== this.lastHash || length !== this.lastLength;

    if (changed) {
      this.lastHash = hash;
      this.lastLength = length;
      this.lastChangedAt = now;
    } else if (this.lastChangedAt === 0) {
      this.lastChangedAt = now;
    }

    return { changed, hash, length };
  }

  stableFor(now = Date.now()): number {
    if (this.lastChangedAt === 0) {
      return 0;
    }

    return now - this.lastChangedAt;
  }

  changedWithin(ms: number, now = Date.now()): boolean {
    return now - this.lastChangedAt <= ms;
  }

  private hashText(text: string): string {
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
      hash = (hash << 5) - hash + text.charCodeAt(index);
      hash |= 0;
    }

    return String(hash);
  }
}
