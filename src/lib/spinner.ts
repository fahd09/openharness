import chalk from "chalk";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class Spinner {
  private frameIdx = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private label = "";
  public running = false;

  start(label?: string): void {
    this.frameIdx = 0;
    this.label = label ?? "";
    this.running = true;
    this.render();
    this.timer = setInterval(() => this.render(), 80);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    this.label = "";
    process.stdout.write("\r\x1b[K");
  }

  setLabel(label: string): void {
    this.label = label;
  }

  private render(): void {
    const frame = FRAMES[this.frameIdx % FRAMES.length];
    this.frameIdx++;
    const labelText = this.label ? ` ${this.label}` : "";
    process.stdout.write(`\r\x1b[K${chalk.dim(`${frame}${labelText}`)}`);
  }
}
