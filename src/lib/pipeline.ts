import { analyzeTranscript } from "@/lib/analysis";
import { findImagesForMoment } from "@/lib/images";
import { createTranscript, getMediaDuration } from "@/lib/media";
import { getProject, resolveDataPath, updateProject } from "@/lib/storage";
import type {
  CandidateVisualMoment,
  Project,
  VisualMoment,
} from "@/lib/types";
import { clamp, createId } from "@/lib/utils";

async function setStatus(
  projectId: string,
  status: Project["status"],
  statusMessage: string,
): Promise<Project> {
  return updateProject(projectId, (project) => ({
    ...project,
    status,
    statusMessage,
    error: undefined,
  }));
}

function candidateFromVisual(visual: VisualMoment): CandidateVisualMoment {
  return {
    start_time: visual.startTime,
    end_time: visual.endTime,
    transcript_excerpt: visual.transcriptExcerpt,
    visual_priority_score: visual.visualPriorityScore,
    why_visual_is_helpful: visual.whyVisualIsHelpful,
    search_query_1: visual.searchQueries[0],
    search_query_2: visual.searchQueries[1],
    search_query_3: visual.searchQueries[2],
    suggested_visual_type: visual.suggestedVisualType,
  };
}

export function mergeLowConfidenceVisuals(
  visuals: VisualMoment[],
  replacements: ReadonlyMap<
    string,
    { images: VisualMoment["candidates"]; confidence: number }
  >,
): VisualMoment[] {
  return visuals.map((visual) => {
    if (visual.confidence >= 0.62 && visual.candidates.length > 0) {
      return visual;
    }
    const replacement = replacements.get(visual.id);
    return replacement
      ? {
          ...visual,
          candidates: replacement.images,
          chosenImageId: replacement.images[0].id,
          confidence: replacement.confidence,
        }
      : visual;
  });
}

async function regenerateLowConfidenceVisuals(
  project: Project,
): Promise<Project> {
  const targets = project.visuals.filter(
    (visual) => visual.confidence < 0.62 || visual.candidates.length === 0,
  );
  if (targets.length === 0) {
    return updateProject(project.id, (current) => ({
      ...current,
      status: "generated",
      statusMessage: "No low-confidence visuals need regeneration",
      error: undefined,
    }));
  }

  await setStatus(
    project.id,
    "searching",
    "Refreshing only low-confidence image choices",
  );
  const replacements = new Map<
    string,
    { images: VisualMoment["candidates"]; confidence: number }
  >();
  for (const visual of targets) {
    const images = await findImagesForMoment(candidateFromVisual(visual));
    if (images.length > 0) {
      replacements.set(visual.id, {
        images,
        confidence: clamp(
          (visual.visualPriorityScore / 100) * 0.65 + 0.3,
          0,
          0.96,
        ),
      });
    }
  }

  await setStatus(
    project.id,
    "selecting",
    "Ranking refreshed image choices",
  );
  return updateProject(project.id, (current) => ({
    ...current,
    status: "generated",
    statusMessage: "Low-confidence visuals regenerated",
    error: undefined,
    outputVideoPath:
      replacements.size > 0 ? undefined : current.outputVideoPath,
    visuals: mergeLowConfidenceVisuals(current.visuals, replacements),
  }));
}

export async function generateProject(
  projectId: string,
  lowConfidenceOnly = false,
): Promise<Project> {
  let project = await getProject(projectId);
  try {
    if (!lowConfidenceOnly || project.transcript.length === 0) {
      project = await setStatus(
        project.id,
        "transcribing",
        "Creating a timestamped transcript",
      );
      const mediaPath = resolveDataPath(project.mediaPath);
      const duration = await getMediaDuration(mediaPath);
      const transcription = await createTranscript(
        mediaPath,
        duration,
        project.script,
      );
      project = await updateProject(project.id, (current) => ({
        ...current,
        duration,
        transcript: transcription.segments,
        transcriptSource: transcription.source,
      }));
    }

    if (lowConfidenceOnly && project.visuals.length > 0) {
      return regenerateLowConfidenceVisuals(project);
    }

    project = await setStatus(
      project.id,
      "analyzing",
      "Finding only the moments that deserve a visual",
    );
    const candidates = await analyzeTranscript(
      project.transcript,
      project.duration,
      project.visualFrequency,
    );

    project = await setStatus(
      project.id,
      "searching",
      "Searching authoritative image sources",
    );
    const existingByExcerpt = new Map(
      project.visuals.map((visual) => [visual.transcriptExcerpt, visual]),
    );
    const visuals: VisualMoment[] = [];
    for (const candidate of candidates) {
      const existing = existingByExcerpt.get(candidate.transcript_excerpt);
      const images = await findImagesForMoment(candidate);
      const confidence = images.length
        ? clamp((candidate.visual_priority_score / 100) * 0.65 + 0.3, 0, 0.96)
        : 0.25;
      if (images.length === 0 && candidate.visual_priority_score < 70) {
        continue;
      }
      visuals.push({
        id: existing?.id ?? createId("moment"),
        startTime: clamp(candidate.start_time, 0, project.duration),
        endTime: clamp(
          Math.max(candidate.end_time, candidate.start_time + 4),
          0,
          project.duration,
        ),
        transcriptExcerpt: candidate.transcript_excerpt,
        visualPriorityScore: candidate.visual_priority_score,
        whyVisualIsHelpful: candidate.why_visual_is_helpful,
        searchQueries: [
          candidate.search_query_1,
          candidate.search_query_2,
          candidate.search_query_3,
        ],
        suggestedVisualType: candidate.suggested_visual_type,
        confidence,
        candidates: images,
        chosenImageId: images[0]?.id,
        removed: false,
      });
    }

    project = await setStatus(
      project.id,
      "selecting",
      "Ranking the clearest, most specific images",
    );
    return updateProject(project.id, (current) => ({
      ...current,
      status: "generated",
      statusMessage: "Visual timeline ready for review",
      visuals,
      outputVideoPath: undefined,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed";
    return updateProject(project.id, (current) => ({
      ...current,
      status: "error",
      statusMessage: message,
      error: message,
    }));
  }
}
