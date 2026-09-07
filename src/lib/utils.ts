import { randomUUID } from "node:crypto";

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function formatTimestamp(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
    : `${minutes}:${secs.toString().padStart(2, "0")}`;
}

export function formatSrtTimestamp(seconds: number): string {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const ms = milliseconds % 1000;
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${secs.toString().padStart(2, "0")},${ms
    .toString()
    .padStart(3, "0")}`;
}

export function safeFileName(fileName: string): string {
  const extension = fileName.includes(".") ? `.${fileName.split(".").pop()}` : "";
  const stem = fileName.slice(0, extension ? -extension.length : undefined);
  const safeStem = stem
    .normalize("NFKD")
    .replaceAll(/[^a-zA-Z0-9-_]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${safeStem || "media"}${extension.toLowerCase()}`;
}

export function normalizeVisualInterval(
  currentStart: number,
  currentEnd: number,
  requestedStart: number | undefined,
  requestedEnd: number | undefined,
  duration: number,
): { startTime: number; endTime: number } {
  const boundedDuration = Math.max(0, duration);
  if (boundedDuration <= 0.5) {
    return { startTime: 0, endTime: boundedDuration };
  }

  let startTime = clamp(
    requestedStart ?? currentStart,
    0,
    boundedDuration,
  );
  let endTime = clamp(requestedEnd ?? currentEnd, 0, boundedDuration);
  if (endTime - startTime < 0.5) {
    if (requestedStart !== undefined && requestedEnd === undefined) {
      startTime = Math.min(startTime, boundedDuration - 0.5);
      endTime = Math.max(endTime, startTime + 0.5);
    } else {
      endTime = Math.min(boundedDuration, Math.max(endTime, startTime + 0.5));
      startTime = Math.max(0, Math.min(startTime, endTime - 0.5));
    }
  }
  return { startTime, endTime };
}

export async function retry<T>(
  operation: () => Promise<T>,
  attempts = 3,
  initialDelayMs = 500,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, initialDelayMs * 2 ** attempt),
        );
      }
    }
  }
  throw lastError;
}

export function assertSafeId(value: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error("Invalid identifier");
  }
}
