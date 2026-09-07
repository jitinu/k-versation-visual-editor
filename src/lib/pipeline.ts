import { analyzeTranscript } from "@/lib/analysis";
import { findImagesForMoment } from "@/lib/images";
import { createTranscript, getMediaDuration } from "@/lib/media";
import { getProject, resolveDataPath, saveProject } from "@/lib/storage";
import type { Project, VisualMoment } from "@/lib/types";
import { clamp, createId } from "@/lib/utils";

async function setStatus(
  project: Project,
  status: Project["status"],
  statusMessage: string,
): Promise<Project> {
  return saveProject({ ...project, status, statusMessage, error: undefined });
}

export async function generateProject(
  projectId: string,
  lowConfidenceOnly = false,
): Promise<Project> {
  let project = await getProject(projectId);
  try {
    if (!lowConfidenceOnly || project.transcript.length === 0) {
      project = await setStatus(
        project,
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
      project = await saveProject({
        ...project,
        duration,
        transcript: transcription.segments,
        transcriptSource: transcription.source,
      });
    }

    project = await setStatus(
      project,
      "analyzing",
      "Finding only the moments that deserve a visual",
    );
    const candidates = await analyzeTranscript(
      project.transcript,
      project.duration,
      project.visualFrequency,
    );

    project = await setStatus(
      project,
      "searching",
      "Searching authoritative image sources",
    );
    const existingByExcerpt = new Map(
      project.visuals.map((visual) => [visual.transcriptExcerpt, visual]),
    );
    const visuals: VisualMoment[] = [];
    for (const candidate of candidates) {
      const existing = existingByExcerpt.get(candidate.transcript_excerpt);
      if (
        lowConfidenceOnly &&
        existing &&
        existing.confidence >= 0.62 &&
        existing.candidates.length > 0
      ) {
        visuals.push(existing);
        continue;
      }
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
      { ...project, visuals },
      "selecting",
      "Ranking the clearest, most specific images",
    );
    return saveProject({
      ...project,
      status: "generated",
      statusMessage: "Visual timeline ready for review",
      visuals,
      outputVideoPath: undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed";
    return saveProject({
      ...project,
      status: "error",
      statusMessage: message,
      error: message,
    });
  }
}
