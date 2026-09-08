import { config, type SearchProvider } from "../config";
import { createLogger } from "../logger";
import type { CandidateMoment, ImageCandidate } from "../types";
import { newId, withRetry } from "../util";

const log = createLogger("search");

const USER_AGENT = "k-versation-visual-editor/0.1 (personal documentary tool)";

/** Domain-based authority score: higher = more trustworthy source. */
export function authorityFor(domain: string): number {
  const d = domain.toLowerCase();
  if (d.endsWith("wikimedia.org") || d.endsWith("wikipedia.org")) return 1.0;
  if (d.endsWith(".gov") || d.includes(".gov.") || d.endsWith(".mil")) return 0.95;
  if (d.endsWith(".edu") || d.includes(".ac.")) return 0.9;
  if (/(museum|archive|archives|library|loc\.gov|britishmuseum|smithsonian|nationalarchives|europeana|gallica|rijksmuseum|metmuseum)/.test(d))
    return 0.9;
  if (/(britannica|history\.com|nationalgeographic|bbc\.co\.uk|nytimes|reuters|apnews)/.test(d)) return 0.7;
  if (/(shutterstock|gettyimages|alamy|istockphoto|dreamstime|123rf|depositphotos|adobe\.com|stock)/.test(d)) return 0.1;
  if (/(pinterest|facebook|instagram|twitter|x\.com|tiktok|reddit|quora)/.test(d)) return 0.15;
  return 0.4;
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.search.timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- Wikimedia Commons (no key required) ---------------- */

interface CommonsResponse {
  query?: {
    pages?: Record<
      string,
      {
        title: string;
        imageinfo?: Array<{
          url: string;
          thumburl?: string;
          descriptionurl: string;
          width: number;
          height: number;
          mime: string;
          extmetadata?: Record<string, { value: string }>;
        }>;
      }
    >;
  };
}

function stripHtml(s: string | undefined): string | undefined {
  return s ? s.replace(/<[^>]+>/g, "").trim() : undefined;
}

async function searchWikimedia(query: string, limit: number): Promise<ImageCandidate[]> {
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: "6",
    gsrlimit: String(limit),
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: "1600",
    iiextmetadatafilter: "Artist|LicenseShortName|ImageDescription|Credit",
    format: "json",
    origin: "*",
  });
  const json = await fetchJson<CommonsResponse>(`https://commons.wikimedia.org/w/api.php?${params}`);
  const pages = Object.values(json.query?.pages ?? {});
  return pages
    .filter((p) => p.imageinfo?.[0] && /^image\/(jpeg|png|webp|tiff|gif)$/.test(p.imageinfo[0].mime))
    .map((p) => {
      const ii = p.imageinfo![0];
      const meta = ii.extmetadata ?? {};
      return {
        id: newId("img"),
        imageUrl: ii.thumburl ?? ii.url,
        thumbnailUrl: ii.thumburl,
        sourcePageUrl: ii.descriptionurl,
        sourceName: "Wikimedia Commons",
        title: p.title.replace(/^File:/, ""),
        domain: "commons.wikimedia.org",
        width: ii.thumburl ? Math.min(ii.width, 1600) : ii.width,
        height: ii.thumburl ? Math.round((Math.min(ii.width, 1600) / ii.width) * ii.height) : ii.height,
        attribution: stripHtml(meta.Artist?.value) ?? stripHtml(meta.Credit?.value),
        license: meta.LicenseShortName?.value,
        provider: "wikimedia",
        authority: 1.0,
      } satisfies ImageCandidate;
    });
}

/* ---------------- SerpAPI (Google Images) ---------------- */

async function searchSerpApi(query: string, limit: number): Promise<ImageCandidate[]> {
  if (!config.search.serpApiKey) return [];
  const params = new URLSearchParams({
    engine: "google_images",
    q: query,
    api_key: config.search.serpApiKey,
    num: String(limit),
    safe: "active",
  });
  const json = await fetchJson<{
    images_results?: Array<{
      original: string;
      thumbnail: string;
      link: string;
      title: string;
      source: string;
      original_width?: number;
      original_height?: number;
    }>;
  }>(`https://serpapi.com/search.json?${params}`);
  return (json.images_results ?? []).slice(0, limit).map((r) => {
    const domain = domainOf(r.link);
    return {
      id: newId("img"),
      imageUrl: r.original,
      thumbnailUrl: r.thumbnail,
      sourcePageUrl: r.link,
      sourceName: r.source || domain,
      title: r.title,
      domain,
      width: r.original_width,
      height: r.original_height,
      provider: "serpapi",
      authority: authorityFor(domain),
    } satisfies ImageCandidate;
  });
}

/* ---------------- Bing Image Search ---------------- */

async function searchBing(query: string, limit: number): Promise<ImageCandidate[]> {
  if (!config.search.bingApiKey) return [];
  const params = new URLSearchParams({ q: query, count: String(limit), safeSearch: "Strict", minWidth: "800" });
  const json = await fetchJson<{
    value?: Array<{
      contentUrl: string;
      thumbnailUrl: string;
      hostPageUrl: string;
      name: string;
      width: number;
      height: number;
    }>;
  }>(`https://api.bing.microsoft.com/v7.0/images/search?${params}`, {
    headers: { "Ocp-Apim-Subscription-Key": config.search.bingApiKey },
  });
  return (json.value ?? []).map((r) => {
    const domain = domainOf(r.hostPageUrl);
    return {
      id: newId("img"),
      imageUrl: r.contentUrl,
      thumbnailUrl: r.thumbnailUrl,
      sourcePageUrl: r.hostPageUrl,
      sourceName: domain,
      title: r.name,
      domain,
      width: r.width,
      height: r.height,
      provider: "bing",
      authority: authorityFor(domain),
    } satisfies ImageCandidate;
  });
}

/* ---------------- Google Custom Search ---------------- */

async function searchGoogleCse(query: string, limit: number): Promise<ImageCandidate[]> {
  if (!config.search.googleApiKey || !config.search.googleCx) return [];
  const params = new URLSearchParams({
    key: config.search.googleApiKey,
    cx: config.search.googleCx,
    q: query,
    searchType: "image",
    num: String(Math.min(limit, 10)),
    imgSize: "large",
    safe: "active",
  });
  const json = await fetchJson<{
    items?: Array<{
      link: string;
      title: string;
      displayLink: string;
      image: { contextLink: string; width: number; height: number; thumbnailLink: string };
    }>;
  }>(`https://www.googleapis.com/customsearch/v1?${params}`);
  return (json.items ?? []).map((r) => ({
    id: newId("img"),
    imageUrl: r.link,
    thumbnailUrl: r.image.thumbnailLink,
    sourcePageUrl: r.image.contextLink,
    sourceName: r.displayLink,
    title: r.title,
    domain: r.displayLink,
    width: r.image.width,
    height: r.image.height,
    provider: "google",
    authority: authorityFor(r.displayLink),
  }));
}

/* ---------------- MOCK provider (offline) ---------------- */

/**
 * Produces `mock://` candidates that are rendered to local placeholder PNGs by
 * `images.ts` when downloaded. Used when providers are unreachable/unconfigured.
 */
export function mockCandidates(query: string, count: number): ImageCandidate[] {
  return Array.from({ length: count }, (_, i) => ({
    id: newId("img"),
    imageUrl: `mock://placeholder/${encodeURIComponent(query)}/${i}`,
    sourcePageUrl: "https://example.invalid/mock-source",
    sourceName: "MOCK placeholder",
    title: `[MOCK] ${query} #${i + 1}`,
    domain: "example.invalid",
    width: 1600,
    height: 900,
    license: "n/a (generated placeholder)",
    provider: "mock",
    authority: 0.5,
  }));
}

/* ---------------- Orchestration ---------------- */

const providerFns: Record<Exclude<SearchProvider, "mock">, (q: string, limit: number) => Promise<ImageCandidate[]>> = {
  wikimedia: searchWikimedia,
  serpapi: searchSerpApi,
  bing: searchBing,
  google: searchGoogleCse,
};

async function runProvider(provider: SearchProvider, query: string, limit: number): Promise<ImageCandidate[]> {
  if (provider === "mock") return mockCandidates(query, limit);
  return withRetry(() => providerFns[provider](query, limit), {
    retries: config.search.retries,
    onRetry: (err, attempt) => log.warn(`${provider} "${query}" retry ${attempt}`, err),
  });
}

/**
 * Gather 8–20 candidates for a moment. Authoritative providers (Wikimedia) are
 * queried first; broader providers only if we are still short. Falls back to
 * MOCK candidates when every provider fails so the pipeline stays runnable.
 */
export async function searchCandidates(moment: CandidateMoment): Promise<{ candidates: ImageCandidate[]; mocked: boolean }> {
  const queries = [moment.search_query_1, moment.search_query_2, moment.search_query_3].filter((q) => q?.trim());
  const { minCandidates, maxCandidates } = config.search;
  const seen = new Set<string>();
  const out: ImageCandidate[] = [];
  let anySuccess = false;

  const providers: SearchProvider[] = [...config.search.providers];
  if (!providers.includes("wikimedia") && !providers.includes("mock")) providers.unshift("wikimedia");

  for (const provider of providers) {
    for (const q of queries) {
      if (out.length >= maxCandidates) break;
      try {
        const results = await runProvider(provider, q, Math.min(12, maxCandidates - out.length));
        anySuccess = true;
        for (const c of results) {
          if (seen.has(c.imageUrl)) continue;
          seen.add(c.imageUrl);
          out.push(c);
        }
      } catch (err) {
        log.warn(`provider ${provider} failed for "${q}"`, err);
      }
      if (provider === "wikimedia" && out.length >= minCandidates) break;
    }
    if (out.length >= minCandidates) break;
  }

  if (out.length === 0) {
    log.warn(`no results for moment @${moment.start_time}s – using MOCK placeholders`);
    return { candidates: mockCandidates(queries[0] ?? moment.transcript_excerpt, minCandidates), mocked: true };
  }
  log.info(`moment @${moment.start_time}s: ${out.length} candidates (providers ok=${anySuccess})`);
  return { candidates: out.slice(0, maxCandidates), mocked: false };
}
