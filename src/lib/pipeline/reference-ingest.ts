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
