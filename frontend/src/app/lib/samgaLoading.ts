export const SAMGA_LOADING_FRAMES = ["⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const SAMGA_LOADING_LABELS = [
  "SCANNING...",
  "SIFTING...",
  "THREADING...",
  "REASONING...",
  "SHAPING...",
  "DELIVERING...",
];

export function getSamgaLoadingLabel(_lang: string, elapsedSeconds: number) {
  return SAMGA_LOADING_LABELS[
    Math.floor(elapsedSeconds / 4) % SAMGA_LOADING_LABELS.length
  ];
}

export function formatSamgaElapsed(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}
