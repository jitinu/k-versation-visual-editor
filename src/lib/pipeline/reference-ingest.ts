/**
 * STUB — optional future ingestion of K-VERSATION reference videos.
 *
 * Intent: learn the channel's editorial rhythm (how often visuals appear, which
 * kinds of moments get maps vs portraits vs documents) from existing NON-INTERVIEW
 * episodes and feed the findings into `examples.json` / the analysis prompt.
 *
 * This is intentionally NOT implemented in V1 and nothing here downloads content
 * automatically. A future implementation would:
 *   1. Accept a user-provided list of video files or URLs (`ReferenceSource[]`).
 *   2. Transcribe them with the same `transcribe()` pipeline.
 *   3. Detect visual changes (scene cuts) with ffmpeg's `select='gt(scene,0.4)'`.
 *   4. Correlate cuts with transcript content to produce `ReferenceMoment[]`.
 *   5. Let the user review and append the best ones to `examples.json`.
 *
 * Baseline measured manually (ffmpeg scene/black detection) on 13 published episodes,
 * used to calibrate `FREQUENCY_TARGETS` and the analysis prompt:
 *   - runtime 2:33–7:55 (median ≈5:20), 1280x720
 *   - image changes: 3.7–9.8 per minute (runtime-weighted mean 5.8; each visual produces
 *     ~2 cuts, in→out, so ≈3 images/min)
 *   - median shot length ≈5 s, p90 ≈15 s; longest holds are documents/tables
 *   - black screen 50–80% of runtime in most episodes; visuals appear in 8–27 clusters
 *     of 1–3 related images at the introduction of a subject, then black again
 *   - images shown at native aspect ratio, centred on black; hard cuts, no motion
 *   - subjects: portraits/press photos of named people, buildings and places, maps,
 *     manuscripts/documents, logos, tables/infographics, iconic event photos
 */

export interface ReferenceSource {
  /** local path or URL supplied explicitly by the user */
  location: string;
  /** interviews are excluded – only narration-style episodes are useful */
  kind: "narration" | "interview";
}

export interface ReferenceMoment {
  timestamp: number;
  transcript_excerpt: string;
  visual_type_guess: string;
}

export async function ingestReferenceVideos(sources: ReferenceSource[]): Promise<ReferenceMoment[]> {
  const usable = sources.filter((s) => s.kind === "narration");
  if (usable.length === 0) return [];
  throw new Error("Reference video ingestion is not implemented in V1 (see reference-ingest.ts).");
}
