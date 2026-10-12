/** Suspend authorization network requests while the browser backgrounds the app. */
export class ForegroundGate {
  private active = true;
  private readonly resumed = new Set<() => void>();
  setActive(active: boolean): void {
    this.active = active;
    if (active) for (const resume of [...this.resumed]) resume();
  }
  wait(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.active) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.resumed.delete(resume);
        signal.removeEventListener("abort", abort);
      };
      const resume = () => {
        cleanup();
        resolve();
      };
      const abort = () => {
        cleanup();
        reject(signal.reason);
      };
      this.resumed.add(resume);
      signal.addEventListener("abort", abort, { once: true });
    });
  }
}
