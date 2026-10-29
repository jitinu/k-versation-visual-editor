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
  if (
    /(shutterstock|gettyimages|alamy|istockphoto|dreamstime|123rf|depositphotos|adobe\.com|stock|freepik|vecteezy|pngtree|pixabay|pexels|unsplash|canva|storyblocks|pond5|vectorstock|midjourney|lexica|openart)/.test(
      d,
    )
  )
    return 0.1;
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

/* ---------------- Openverse (no key required; CC-licensed images from Flickr, museums, ...) ---------------- */

async function searchOpenverse(query: string, limit: number): Promise<ImageCandidate[]> {
  const params = new URLSearchParams({
    q: query,
    page_size: String(Math.min(limit, 20)),
    mature: "false",
  });
  const json = await fetchJson<{
    results?: Array<{
      id: string;
      title?: string;
      url: string;
      thumbnail?: string;
      foreign_landing_url: string;
      source: string;
      provider: string;
      creator?: string;
      license: string;
      license_version?: string;
      width?: number;
      height?: number;
    }>;
  }>(`https://api.openverse.org/v1/images/?${params}`);
  return (json.results ?? []).map((r) => {
    const domain = domainOf(r.foreign_landing_url) || r.source;
    return {
      id: newId("img"),
      imageUrl: r.url,
      thumbnailUrl: r.thumbnail,
      sourcePageUrl: r.foreign_landing_url,
      sourceName: r.source || r.provider,
      title: r.title ?? query,
      domain,
      width: r.width,
      height: r.height,
      attribution: r.creator,
      license: r.license_version ? `CC ${r.license.toUpperCase()} ${r.license_version}` : r.license,
      provider: "openverse",
      authority: Math.max(authorityFor(domain), 0.6),
    } satisfies ImageCandidate;
  });
}

/* ---------------- DuckDuckGo Images (no key; unofficial endpoint, broad web coverage) ---------------- */

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.search.timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { "User-Agent": BROWSER_UA, ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function searchDuckDuckGo(query: string, limit: number): Promise<ImageCandidate[]> {
  const html = await fetchText(`https://duckduckgo.com/?${new URLSearchParams({ q: query, iax: "images", ia: "images" })}`);
  const vqd = html.match(/vqd=["']?([\d-]+)/)?.[1];
  if (!vqd) throw new Error("DuckDuckGo: could not obtain vqd token");
  const params = new URLSearchParams({ l: "us-en", o: "json", q: query, vqd, f: ",size:Large,,,,", p: "1" });
  const json = JSON.parse(
    await fetchText(`https://duckduckgo.com/i.js?${params}`, {
      headers: { Referer: "https://duckduckgo.com/", Accept: "application/json" },
    }),
  ) as {
    results?: Array<{ title: string; image: string; thumbnail: string; url: string; height: number; width: number; source: string }>;
  };
  return (json.results ?? [])
    .map((r) => {
      const domain = domainOf(r.url);
      return {
        id: newId("img"),
        imageUrl: r.image,
        thumbnailUrl: r.thumbnail,
        sourcePageUrl: r.url,
        sourceName: domain,
        title: r.title,
        domain,
        width: r.width,
        height: r.height,
        provider: "duckduckgo",
        authority: authorityFor(domain),
      } satisfies ImageCandidate;
    })
    .filter((c) => c.authority > 0.1) // drop stock-photo (watermarked) hits up front
    .slice(0, limit);
}

/* ---------------- Bing Images, public page (no key; what a search engine shows first for the title) ---------------- */

type BingWebItem = { murl?: string; purl?: string; turl?: string; t?: string };

async function searchBingWeb(query: string, limit: number): Promise<ImageCandidate[]> {
  const params = new URLSearchParams({ q: query, first: "0", count: String(Math.max(35, limit)), adlt: "strict", qft: "+filterui:imagesize-large" });
  const html = await fetchText(`https://www.bing.com/images/async?${params}`, { headers: { "Accept-Language": "en-US,en;q=0.9" } });
  const out: ImageCandidate[] = [];
  for (const m of html.matchAll(/<a[^>]+class="iusc"[^>]+m="([^"]+)"[^>]*href="([^"]*)"/g)) {
    let item: BingWebItem;
    try {
      item = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&")) as BingWebItem;
    } catch {
      continue;
    }
    if (!item.murl || !/^https?:/i.test(item.murl)) continue;
    const href = m[2].replace(/&amp;/g, "&");
    const width = Number(href.match(/[?&]expw=(\d+)/)?.[1] ?? 0);
    const height = Number(href.match(/[?&]exph=(\d+)/)?.[1] ?? 0);
    const domain = domainOf(item.purl ?? item.murl);
    out.push({
      id: newId("img"),
      imageUrl: item.murl,
      thumbnailUrl: item.turl,
      sourcePageUrl: item.purl ?? item.murl,
      sourceName: domain,
      title: item.t ?? "",
      domain,
      width,
      height,
      provider: "bingweb",
      authority: authorityFor(domain),
    });
  }
  if (!out.length) throw new Error("Bing Images: no results parsed (page layout changed or blocked)");
  return out.filter((c) => c.authority > 0.1).slice(0, limit);
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

/* ---------------- Wikipedia lead images (no key; the main photo of the matching article) ---------------- */

type WikipediaResponse = {
  query?: {
    pages?: Record<
      string,
      {
        pageid: number;
        title: string;
        index?: number;
        pageimage?: string;
        original?: { source: string; width: number; height: number };
        thumbnail?: { source: string; width: number; height: number };
      }
    >;
  };
};

async function searchWikipediaLead(query: string, limit: number): Promise<ImageCandidate[]> {
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrlimit: String(Math.min(limit, 5)),
    prop: "pageimages",
    piprop: "original|thumbnail|name",
    pithumbsize: "1920",
    format: "json",
    origin: "*",
  });
  const json = await fetchJson<WikipediaResponse>(`https://en.wikipedia.org/w/api.php?${params}`);
  const pages = Object.values(json.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return pages
    .filter((p) => p.original && !/\.svg$/i.test(p.original.source))
    .map((p) => ({
      id: newId("img"),
      imageUrl: (p.thumbnail ?? p.original)!.source,
      sourcePageUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`,
      sourceName: "Wikipedia",
      title: `${p.title} (${(p.pageimage ?? "").replace(/_/g, " ")})`,
      domain: "en.wikipedia.org",
      width: (p.thumbnail ?? p.original)!.width,
      height: (p.thumbnail ?? p.original)!.height,
      provider: "wikipedia",
      authority: 1.0,
    }) satisfies ImageCandidate);
}

/* ---------------- Orchestration ---------------- */

const providerFns: Record<Exclude<SearchProvider, "mock">, (q: string, limit: number) => Promise<ImageCandidate[]>> = {
  wikipedia: searchWikipediaLead,
  wikimedia: searchWikimedia,
  openverse: searchOpenverse,
  duckduckgo: searchDuckDuckGo,
  serpapi: searchSerpApi,
  bing: searchBing,
  bingweb: searchBingWeb,
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
 * Gather 8–20 candidates for a moment from EVERY configured provider so the pool is
 * not limited to one source: round 1 runs the most specific query on each provider
 * in parallel (authoritative providers listed first keep their share of the pool);
 * later queries only run while we are still short. Falls back to MOCK candidates
 * when every provider fails so the pipeline stays runnable.
 */
export async function searchCandidates(moment: CandidateMoment): Promise<{ candidates: ImageCandidate[]; mocked: boolean }> {
  const queries = [moment.search_query_1, moment.search_query_2, moment.search_query_3].filter((q) => q?.trim());
  const { minCandidates, maxCandidates } = config.search;
  const seen = new Set<string>();
  const out: ImageCandidate[] = [];
  let anySuccess = false;

  const providers: SearchProvider[] = [...config.search.providers];
  if (!providers.includes("wikimedia") && !providers.includes("mock")) providers.unshift("wikimedia");
  const perProvider = Math.max(8, Math.ceil(maxCandidates / providers.length));

  // results of a fallback query rank below everything the primary query returned
  const add = (results: ImageCandidate[], queryIndex: number) => {
    results.forEach((c, i) => {
      if (!c.imageUrl || seen.has(c.imageUrl)) return;
      seen.add(c.imageUrl);
      c.rank ??= i + queryIndex * perProvider;
      out.push(c);
    });
  };

  for (const [qi, q] of queries.entries()) {
    if (qi > 0 && out.length >= minCandidates) break;
    const settled = await Promise.allSettled(providers.map((p) => runProvider(p, q, perProvider)));
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") {
        anySuccess = true;
        add(r.value, qi);
      } else log.warn(`provider ${providers[i]} failed for "${q}"`, r.reason);
    });
  }

  if (out.length === 0) {
    log.warn(`no results for moment @${moment.start_time}s – using MOCK placeholders`);
    return { candidates: mockCandidates(queries[0] ?? moment.transcript_excerpt, minCandidates), mocked: true };
  }
  // authoritative sources first so the cap keeps them; broader web results fill the rest
  out.sort((a, b) => b.authority - a.authority);
  log.info(`moment @${moment.start_time}s: ${out.length} candidates from ${new Set(out.map((c) => c.provider)).size} providers (ok=${anySuccess})`);
  return { candidates: out.slice(0, maxCandidates), mocked: false };
}
