import type { CandidateVisualMoment, ImageCandidate } from "@/lib/types";
import { clamp, createId, retry } from "@/lib/utils";

interface CommonsPage {
  pageid: number;
  title: string;
  imageinfo?: Array<{
    url?: string;
    thumburl?: string;
    width?: number;
    height?: number;
    descriptionurl?: string;
    extmetadata?: Record<string, { value?: string }>;
  }>;
}

interface CommonsResponse {
  query?: { pages?: Record<string, CommonsPage> };
}

function plainText(value?: string): string | undefined {
  if (!value) return undefined;
  return value.replaceAll(/<[^>]*>/g, "").replaceAll("&amp;", "&").trim();
}

function lexicalScore(candidate: CommonsPage, query: string): number {
  const title = candidate.title.toLowerCase();
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 2);
  return terms.reduce((score, term) => score + (title.includes(term) ? 8 : 0), 0);
}

async function searchCommons(
  query: string,
  limit: number,
): Promise<ImageCandidate[]> {
  const parameters = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "search",
    gsrnamespace: "6",
    gsrsearch: `${query} filetype:bitmap`,
    gsrlimit: String(limit),
    prop: "imageinfo",
    iiprop: "url|size|extmetadata",
    iiurlwidth: "1000",
  });
  const response = await fetch(
    `https://commons.wikimedia.org/w/api.php?${parameters}`,
    {
      headers: {
        "User-Agent": "K-VERSATION/1.0 (personal visual editor)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Wikimedia search failed (${response.status})`);
  }
  const payload = (await response.json()) as CommonsResponse;
  return Object.values(payload.query?.pages ?? {}).flatMap((page) => {
    const info = page.imageinfo?.[0];
    if (!info?.url || !info.thumburl) return [];
    const width = info.width ?? 0;
    const height = info.height ?? 0;
    const resolutionScore = clamp(Math.log2(Math.max(width * height, 1)) * 2, 0, 45);
    const score = lexicalScore(page, query) + resolutionScore;
    return [
      {
        id: createId("image"),
        title: page.title.replace(/^File:/, ""),
        imageUrl: info.url,
        thumbnailUrl: info.thumburl,
        sourceUrl:
          info.descriptionurl ??
          `https://commons.wikimedia.org/?curid=${page.pageid}`,
        sourceName: "Wikimedia Commons",
        width,
        height,
        license: plainText(info.extmetadata?.LicenseShortName?.value),
        attribution:
          plainText(info.extmetadata?.Artist?.value) ??
          plainText(info.extmetadata?.Credit?.value),
        score,
      },
    ];
  });
}

export async function findImagesForMoment(
  moment: CandidateVisualMoment,
): Promise<ImageCandidate[]> {
  const queries = [
    moment.search_query_1,
    moment.search_query_2,
    moment.search_query_3,
  ].filter(Boolean);
  const results: ImageCandidate[] = [];
  for (const query of queries) {
    try {
      results.push(...(await retry(() => searchCommons(query, 10), 3, 400)));
    } catch (error) {
      console.error(`Image search failed for "${query}".`, error);
    }
    if (results.length >= 20) break;
  }

  const deduplicated = new Map<string, ImageCandidate>();
  for (const candidate of results) {
    const existing = deduplicated.get(candidate.imageUrl);
    if (!existing || candidate.score > existing.score) {
      deduplicated.set(candidate.imageUrl, candidate);
    }
  }
  return [...deduplicated.values()]
    .filter(
      (candidate) =>
        candidate.width >= 800 &&
        candidate.height >= 450 &&
        !/\b(logo|icon|coat of arms|flag)\b/i.test(candidate.title),
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}
