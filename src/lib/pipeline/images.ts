import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { execFile } from "node:child_process";
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
    const headers = { "User-Agent": "k-versation-visual-editor/0.1 (personal documentary tool)" };
    let res = await fetch(url, { signal: ctrl.signal, headers });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1500));
      res = await fetch(url, { signal: ctrl.signal, headers });
    }
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
/** Marketplaces and print-on-demand shops: their images are product listings with sales text, not the subject. */
const SHOP_DOMAIN =
  /(etsy|amazon|ebay|aliexpress|alibaba|shopee|lazada|walmart|target\.com|redbubble|teepublic|society6|zazzle|displate|teespring|spreadshirt|cafepress|threadless|printful|gelato|fineartamerica|posterlounge|allposters|art\.com|wayfair|temu|wish\.com|mercari|depop|poshmark|^shop\.|^store\.|\bshop\b|\bstore\b|merch)/i;
const LISTING_TITLE =
  /\b(printable|digital download|instant download|wall art|poster|sticker|t-?shirt|hoodie|mug|merch|buy now|for sale|price|template|clipart|cricut|etsy|amazon)\b/i;

export function isShopListing(c: { domain?: string; title?: string; provider?: string }): boolean {
  if (c.provider === "wikipedia" || c.provider === "wikimedia") return false;
  return SHOP_DOMAIN.test(c.domain ?? "") || LISTING_TITLE.test(c.title ?? "");
}

let tesseractAvailable: boolean | undefined;

/** Words tesseract is at least 70% sure about; photos of trees and grass yield none, real text yields plenty. */
async function ocrWords(buf: Buffer): Promise<string[]> {
  if (tesseractAvailable === false) return [];
  const tsv = await new Promise<string>((resolve) => {
    const child = execFile(
      "tesseract",
      ["stdin", "stdout", "--psm", "11", "-l", "eng", "tsv"],
      { timeout: 15_000, maxBuffer: 4 << 20, encoding: "utf8" },
      (err, stdout) => {
        if (err && (err as NodeJS.ErrnoException).code === "ENOENT") {
          tesseractAvailable = false;
          log.warn("tesseract not installed; skipping text check");
          return resolve("");
        }
        tesseractAvailable = true;
        resolve(err ? "" : String(stdout));
      },
    );
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(buf);
  });
  return tsv
    .split("\n")
    .slice(1)
    .map((l) => l.split("\t"))
    .filter((r) => r.length >= 12 && Number(r[10]) >= 70 && /^[A-Za-z]{3,}$/.test(r[11]) && /[aeiouy]/i.test(r[11]))
    .map((r) => r[11]);
}

const SALES_TEXT =
  /\b(download|printable|instant|sizes? included|wall art|poster|shop|buy|sale|price|order|etsy|amazon|digital|shipping|cart)\b/i;

/**
 * OCR the picture and reject product listings: they carry sales text such as
 * "Printable Wall Art, Digital Download, 4 Sizes Included". Text as such is fine; a fan
 * chant guide or an infographic can be exactly the right cover.
 */
export async function textCheck(buf: Buffer): Promise<{ reject?: string }> {
  const img = await sharp(buf, { failOn: "none" }).rotate().resize({ width: 1200, withoutEnlargement: true }).png().toBuffer();
  const words = await ocrWords(img);
  if (!words.length) return {};
  const text = words.join(" ");
  if (SALES_TEXT.test(text)) return { reject: `sales text in image: "${text.slice(0, 60)}"` };
  return {};
}

/** Camera-roll style names (IMG_1234, DSC0001, 20200731 162246) say nothing about the subject. */
const GENERIC_TITLE = /\b(img|dsc[nf]?|pxl|p\d{7}|\d{8}[ _-]\d{6}|screenshot|untitled)\b/i;

const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2);

/** Share of the query's words that appear in the candidate's title or page URL (0..1; 0.5 when there is no query). */
export function titleRelevance(query: string | undefined, c: { title?: string; sourcePageUrl?: string }): number {
  const q = tokens(query ?? "");
  if (!q.length) return 0.5;
  const hay = [...new Set(tokens(`${c.title ?? ""} ${decodeURIComponent(c.sourcePageUrl ?? "")}`))];
  const joined = hay.join("");
  const stem = (w: string) => w.replace(/(es|s)$/, "");
  const hit = q.filter((t) => {
    const st = stem(t);
    if (hay.some((h) => h.startsWith(st) || st.startsWith(stem(h)))) return true;
    // "fan chants" vs "Fanchant", "kpop" vs "K-POP": compound words and hyphenation
    return st.length >= 4 && (hay.some((h) => h.includes(st)) || joined.includes(st));
  }).length;
  return +(hit / q.length).toFixed(3);
}

/**
 * How "iconic" a candidate is likely to be. Search engines put the picture people expect
 * first, so position matters; Commons search is not popularity-ranked, so it gets a flat
 * middle score. The Wikipedia lead image gets a bonus only when the article title matches
 * the query (the "Kakao" article's photo is not the picture for "Kakao Friends").
 */
function popularity(query: string | undefined, c: ImageCandidate): { rankScore: number; leadBonus: number } {
  if (c.provider === "wikipedia") {
    const articleTitle = (c.title ?? "").replace(/\s*\(.*\)$/, "");
    const match = titleRelevance(query, { title: articleTitle });
    return { rankScore: match, leadBonus: match >= 0.8 ? 0.15 : 0 };
  }
  if (c.provider === "wikimedia" || c.provider === "openverse") return { rankScore: 0.5, leadBonus: 0 };
  // the first result is the picture people expect to see for the title
  return { rankScore: Math.max(0, 1 - (c.rank ?? 0) / 8), leadBonus: c.rank === 0 ? 0.1 : 0 };
}

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
  query?: string,
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

      if (isShopListing(cand)) {
        cand.rejected = "shop listing / product image";
        results.push(cand);
        continue;
      }
      if (width * height < config.filter.minWidth * config.filter.minHeight || Math.min(width, height) < 500) {
        cand.rejected = `too small (${width}x${height})`;
        results.push(cand);
        continue;
      }
      const aspect = width / height;
      if (aspect < 0.6 || aspect > 3.2) {
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

      const text = await textCheck(buf);
      if (text.reject) {
        cand.rejected = text.reject;
        results.push(cand);
        continue;
      }

      // fills the 1920x1080 canvas in at least one direction (a tall guide sheet that fills the height is fine)
      const resScore = Math.min(1, Math.max(width / 1920, height / 1080));
      const aspectScore = 1 - Math.min(1, Math.abs(aspect - 16 / 9) / 2);
      cand.relevance = titleRelevance(query, cand);
      const { rankScore, leadBonus } = popularity(query, cand);
      const genericPenalty = GENERIC_TITLE.test(cand.title ?? "") ? 0.25 : 0;
      cand.prefilterScore = +Math.max(
        0,
        0.35 * cand.relevance +
          0.35 * rankScore +
          0.1 * resScore +
          0.05 * aspectScore +
          0.05 * cand.authority +
          leadBonus -
          genericPenalty,
      ).toFixed(3);
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
