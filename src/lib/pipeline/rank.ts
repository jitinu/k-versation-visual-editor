import sharp from "sharp";
import { config } from "../config";
import { chatJson } from "../llm/openai";
import { createLogger } from "../logger";
import type { CandidateMoment, ImageCandidate } from "../types";
import { readLocalImage } from "./images";
import { visionRankSystemPrompt } from "./prompts";

const log = createLogger("rank");

export interface RankResult {
  candidates: ImageCandidate[];
  chosenId: string | null;
  confidence: number;
  skippedReason?: string;
}

async function toDataUrl(projectId: string, rel: string): Promise<string> {
  const buf = await readLocalImage(projectId, rel);
  const small = await sharp(buf).resize({ width: 768, withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
  return `data:image/jpeg;base64,${small.toString("base64")}`;
}

async function visionScore(
  projectId: string,
  moment: CandidateMoment,
  cands: ImageCandidate[],
): Promise<Map<string, { score: number; reason: string; acceptable: boolean }>> {
  const content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "low" } }> = [
    {
      type: "text",
      text:
        `NARRATION MOMENT (${moment.start_time.toFixed(1)}–${moment.end_time.toFixed(1)}s): "${moment.transcript_excerpt}"\n` +
        `WHY A VISUAL HELPS: ${moment.why_visual_is_helpful}\nDESIRED TYPE: ${moment.suggested_visual_type}\n` +
        `Evaluate the ${cands.length} images below (index order). Titles: ` +
        cands.map((c, i) => `[${i}] ${c.title} (${c.domain})`).join("; "),
    },
  ];
  for (const c of cands) {
    content.push({ type: "image_url", image_url: { url: await toDataUrl(projectId, c.localPath!), detail: "low" } });
  }
  const res = await chatJson<{ results: Array<{ index: number; score: number; reason: string; acceptable: boolean }> }>(
    [
      { role: "system", content: visionRankSystemPrompt() },
      { role: "user", content },
    ],
    { model: config.openai.visionModel, temperature: 0.1, maxTokens: 1500 },
  );
  const map = new Map<string, { score: number; reason: string; acceptable: boolean }>();
  for (const r of res.results ?? []) {
    const c = cands[r.index];
    if (c) map.set(c.id, { score: Math.max(0, Math.min(1, r.score)), reason: r.reason, acceptable: r.acceptable !== false });
  }
  return map;
}

/**
 * Rank pre-filtered candidates. Vision ranking is config-toggleable
 * (VISION_RANKING_ENABLED); otherwise ordering uses the prefilter score.
 * If nothing is confident enough the moment is SKIPPED (chosenId=null).
 */
export async function rankCandidates(
  projectId: string,
  moment: CandidateMoment,
  candidates: ImageCandidate[],
): Promise<RankResult> {
  const viable = candidates.filter((c) => !c.rejected && c.localPath);
  if (viable.length === 0) {
    return { candidates, chosenId: null, confidence: 0, skippedReason: "no candidate passed the pre-filter" };
  }

  let useVision = config.vision.enabled && config.llm.provider === "openai";
  const shortlist = [...viable]
    .sort((a, b) => (b.prefilterScore ?? 0) - (a.prefilterScore ?? 0))
    .slice(0, config.vision.maxCandidatesPerMoment);

  if (useVision) {
    try {
      const scores = await visionScore(projectId, moment, shortlist);
      for (const c of shortlist) {
        const s = scores.get(c.id);
        if (!s) continue;
        c.visionScore = s.score;
        c.visionReason = s.reason;
        if (!s.acceptable) c.rejected = `vision: ${s.reason}`;
      }
    } catch (err) {
      log.warn("vision ranking failed; falling back to prefilter ordering", err);
      useVision = false;
    }
  }

  const ranked = shortlist
    .filter((c) => !c.rejected)
    .sort((a, b) => finalScore(b, useVision) - finalScore(a, useVision));

  if (ranked.length === 0) {
    return { candidates, chosenId: null, confidence: 0, skippedReason: "vision model rejected every candidate" };
  }
  const best = ranked[0];
  const confidence = finalScore(best, useVision);
  const threshold = useVision ? config.vision.minConfidence : 0.35;
  if (confidence < threshold) {
    return {
      candidates,
      chosenId: null,
      confidence,
      skippedReason: `best candidate confidence ${confidence.toFixed(2)} below ${threshold}`,
    };
  }
  // keep 1 primary + up to 8 alternatives that passed
  const keepIds = new Set(ranked.slice(0, 9).map((c) => c.id));
  const ordered = [
    ...ranked.slice(0, 9),
    ...candidates.filter((c) => !keepIds.has(c.id)),
  ];
  return { candidates: ordered, chosenId: best.id, confidence: +confidence.toFixed(3) };
}

function finalScore(c: ImageCandidate, useVision: boolean): number {
  if (useVision && c.visionScore !== undefined) return 0.75 * c.visionScore + 0.25 * (c.prefilterScore ?? 0);
  return c.prefilterScore ?? 0;
}
