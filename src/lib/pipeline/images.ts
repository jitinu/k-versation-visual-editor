import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { config } from "../config";
import { createLogger } from "../logger";
import { ensureDir, resolveInProject } from "../storage/files";
import type { ImageCandidate } from "../types";

const log = createLogger("images");

const STOCK_HINT = /(shutterstock|getty|alamy|istock|dreamstime|123rf|depositphotos|stock photo|watermark|clipart|vector)/i;

/** Render a labelled placeholder PNG for mock:// candidates. */
async function renderPlaceholder(label: string, index: number): Promise<Buffer> {
  const hue = (index * 47) % 360;
  const safe = label.replace(/[<>&"]/g, "").slice(0, 60);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900">
    <rect width="100%" height="100%" fill="hsl(${hue},35%,25%)"/>
    <text x="50%" y="46%" font-family="sans-serif" font-size="56" fill="#fff" text-anchor="middle">${safe}</text>
    <text x="50%" y="58%" font-family="sans-serif" font-size="30" fill="#ddd" text-anchor="middle">MOCK PLACEHOLDER #${index + 1} – configure an image search provider</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function fetchImage(url: string): Promise<Buffer> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.search.timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "k-versation-visual-editor/0.1 (personal documentary tool)" },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) throw new Error(`not an image: ${type}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 25 * 1024 * 1024) throw new Error("image too large");
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

/** 8x8 difference hash for near-duplicate detection. */
export async function dHash(buf: Buffer): Promise<string> {
  const { data } = await sharp(buf).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  let bits = "";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits += data[y * 9 + x] < data[y * 9 + x + 1] ? "1" : "0";
    }
  }
  return BigInt("0b" + bits).toString(16).padStart(16, "0");
}

export function hammingHex(a: string, b: string): number {
  const x = BigInt("0x" + a) ^ BigInt("0x" + b);
  let n = 0;
  for (const ch of x.toString(2)) if (ch === "1") n++;
  return n;
}

/**
 * Download candidates into the project, normalise to JPEG, record dimensions,
 * and apply the CHEAP pre-filter (resolution, aspect, near-duplicate, stock/watermark
 * heuristics). Rejected candidates are kept with a `rejected` reason for transparency.
 */
export async function downloadAndPrefilter(
  projectId: string,
  entryId: string,
  candidates: ImageCandidate[],
): Promise<ImageCandidate[]> {
  const dir = resolveInProject(projectId, path.join("images", entryId));
  await ensureDir(dir);
  const hashes: string[] = [];
  const results: ImageCandidate[] = [];

  for (const [i, c] of candidates.entries()) {
    const cand: ImageCandidate = { ...c };
    try {
      if (STOCK_HINT.test(`${c.domain} ${c.title}`)) {
        cand.rejected = "stock/watermark heuristic";
        results.push(cand);
        continue;
      }
      const buf = c.imageUrl.startsWith("mock://")
        ? await renderPlaceholder(decodeURIComponent(c.imageUrl.split("/")[3] ?? "placeholder"), i)
        : await fetchImage(c.imageUrl);

      const img = sharp(buf, { failOn: "none" });
      const meta = await img.metadata();
      const width = meta.width ?? 0;
      const height = meta.height ?? 0;
      cand.width = width;
      cand.height = height;

      if (width < config.filter.minWidth || height < config.filter.minHeight) {
        cand.rejected = `too small (${width}x${height})`;
        results.push(cand);
        continue;
      }
      const aspect = width / height;
      if (aspect < 0.5 || aspect > 3.2) {
        cand.rejected = `extreme aspect ratio (${aspect.toFixed(2)})`;
        results.push(cand);
        continue;
      }
      const hash = await dHash(buf);
      if (hashes.some((h) => hammingHex(h, hash) <= 6)) {
        cand.rejected = "near-duplicate";
        results.push(cand);
        continue;
      }
      hashes.push(hash);

      const rel = path.join("images", entryId, `${c.id}.jpg`);
      await sharp(buf, { failOn: "none" })
        .rotate()
        .resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#000" })
        .jpeg({ quality: 90 })
        .toFile(resolveInProject(projectId, rel));
      cand.localPath = rel;

      const resScore = Math.min(1, Math.min(width / 1920, height / 1080));
      const aspectScore = 1 - Math.min(1, Math.abs(aspect - 16 / 9) / 2);
      cand.prefilterScore = +(0.5 * cand.authority + 0.3 * resScore + 0.2 * aspectScore).toFixed(3);
      results.push(cand);
    } catch (err) {
      cand.rejected = `download failed (${(err as Error).message})`;
      results.push(cand);
      log.debug(`candidate ${c.imageUrl} rejected`, err);
    }
  }
  const kept = results.filter((r) => !r.rejected).length;
  log.info(`entry ${entryId}: ${kept}/${candidates.length} candidates passed prefilter`);
  return results;
}

export async function saveUploadedImage(
  projectId: string,
  entryId: string,
  buf: Buffer,
  originalName: string,
): Promise<ImageCandidate> {
  const id = `img_manual_${Date.now().toString(36)}`;
  const rel = path.join("images", entryId, `${id}.jpg`);
  const abs = resolveInProject(projectId, rel);
  await ensureDir(path.dirname(abs));
  const info = await sharp(buf, { failOn: "none" })
    .rotate()
    .resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#000" })
    .jpeg({ quality: 92 })
    .toFile(abs);
  return {
    id,
    imageUrl: `local://${rel}`,
    sourcePageUrl: "",
    sourceName: "Manual upload",
    title: originalName,
    domain: "local",
    width: info.width,
    height: info.height,
    provider: "manual",
    authority: 1,
    localPath: rel,
    manual: true,
    prefilterScore: 1,
    visionScore: 1,
  };
}

export async function readLocalImage(projectId: string, rel: string): Promise<Buffer> {
  return fs.readFile(resolveInProject(projectId, rel));
}
