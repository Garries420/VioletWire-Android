/** Right-aligned clock entry: 1000 becomes 10:00, 13000 becomes 1:30:00. */
export function formatDownloadTime(text: string): string {
  const digits = text.replace(/\D/g, "").slice(0, 7);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, -2)}:${digits.slice(-2)}`;
  return `${digits.slice(0, -4)}:${digits.slice(-4, -2)}:${digits.slice(-2)}`;
}
export function parseDownloadTime(text: string): number {
  const parts = text.trim().split(":");
  if (parts.length > 3 || !parts.every((p) => /^\d+$/.test(p)))
    throw new Error("Enter a time as hours:minutes:seconds.");
  if (
    (parts.length > 1 && Number(parts.at(-1)) >= 60) ||
    (parts.length > 2 && Number(parts.at(-2)) >= 60)
  )
    throw new Error("Minutes and seconds must be below 60.");
  return parts.reduce((total, p) => total * 60 + Number(p), 0);
}
export function downloadRange(from: string, to: string, duration: number) {
  const start = parseDownloadTime(from),
    end = parseDownloadTime(to);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end <= start ||
    end > duration
  )
    throw new Error(
      "Choose an end time after the start, within the video duration.",
    );
  return { start, end };
}
