import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config";

/**
 * Local file storage. All paths are confined to `config.dataDir`.
 * A cloud backend (S3-compatible) can be plugged in via STORAGE_BACKEND;
 * for V1 only `local` is implemented, `s3` falls back to local with a warning.
 */

export function projectsRoot(): string {
  return path.join(config.dataDir, "projects");
}

export function projectDir(projectId: string): string {
  assertSafeSegment(projectId);
  return path.join(projectsRoot(), projectId);
}

export function assertSafeSegment(segment: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) {
    throw new Error(`Unsafe path segment: ${segment}`);
  }
}

/** Resolve a path relative to a project dir and make sure it stays inside it. */
export function resolveInProject(projectId: string, relative: string): string {
  const root = projectDir(projectId);
  const abs = path.resolve(root, relative);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error("Path escapes project directory");
  }
  return abs;
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function ensureProjectDirs(projectId: string): Promise<void> {
  const root = projectDir(projectId);
  await Promise.all(
    ["media", "images", "renders", "uploads"].map((d) => ensureDir(path.join(root, d))),
  );
}

export function safeFileName(name: string): string {
  const base = path.basename(name).replace(/[^A-Za-z0-9._-]/g, "_");
  return base.length ? base.slice(0, 120) : "file";
}

export async function writeProjectFile(
  projectId: string,
  relative: string,
  data: Buffer | Uint8Array | string,
): Promise<string> {
  const abs = resolveInProject(projectId, relative);
  await ensureDir(path.dirname(abs));
  await fs.writeFile(abs, data);
  return relative;
}

export async function fileExists(abs: string): Promise<boolean> {
  try {
    await fs.access(abs);
    return true;
  } catch {
    return false;
  }
}

export function extensionFor(mime: string, fallback = "bin"): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/tiff": "tif",
    "image/svg+xml": "svg",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
  };
  return map[mime.split(";")[0]] ?? fallback;
}
