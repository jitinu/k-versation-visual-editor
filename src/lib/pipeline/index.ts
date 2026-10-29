import path from "node:path";
import { createLogger } from "../logger";
import { startJob, type JobContext } from "../jobs";
import { requireProject, updateProject } from "../storage/projects";
import { ensureDir, resolveInProject } from "../storage/files";
import type { CandidateMoment, JobState, Project, TimelineEntry, VisualFrequency } from "../types";
import { alignScriptToTranscript } from "./align";
import { analyzeMoments } from "./analyze";
import { downloadAndPrefilter } from "./images";
import { rankCandidates } from "./rank";
import { buildRenderPlan, runFfmpeg } from "./render";
import { searchCandidates } from "./search";
import { entryFromMoment, normalizeTimeline } from "./timeline";
import { generateTitle } from "./title";
import { transcribe } from "./transcribe";
import { mediaQueryFromFilename } from "../query";

const log = createLogger("pipeline");

async function buildEntry(
  projectId: string,
  moment: CandidateMoment,
  duration: number | undefined,
  existingId?: string,
): Promise<TimelineEntry> {
  const entryId = existingId ?? `tl_${Math.random().toString(36).slice(2, 10)}`;
  const { candidates } = await searchCandidates(moment);
  const filtered = await downloadAndPrefilter(projectId, entryId, candidates);
  const ranked = await rankCandidates(projectId, moment, filtered);
  if (!ranked.chosenId) log.info(`moment @${moment.start_time}s skipped: ${ranked.skippedReason}`);
  const entry = entryFromMoment(moment, ranked.candidates, ranked.chosenId, ranked.confidence, duration);
  entry.id = entryId;
  return entry;
}

function momentFromEntry(e: TimelineEntry): CandidateMoment {
  return {
    start_time: e.start,
    end_time: e.end,
    transcript_excerpt: e.excerpt,
    visual_priority_score: e.priority,
    why_visual_is_helpful: e.reason,
    search_query_1: e.searchQueries[0] ?? e.excerpt,
    search_query_2: e.searchQueries[1] ?? "",
    search_query_3: e.searchQueries[2] ?? "",
    suggested_visual_type: e.visualType,
  };
}

/** Full generation: transcribe → align → title → analyze → search → rank → timeline. */
export function startGenerateJob(projectId: string, opts: { frequency?: VisualFrequency; skipTranscription?: boolean } = {}): JobState {
  return startJob("generate", projectId, async (ctx) => {
    let project = await requireProject(projectId);
    if (!project.mediaPath) throw new Error("Upload an audio/video file first");
    if (opts.frequency && opts.frequency !== project.frequency) {
      project = await updateProject(projectId, (p) => {
        p.frequency = opts.frequency!;
      });
    }

    if (!opts.skipTranscription || !project.transcript) {
      await ctx.update("transcribing", 5, "Transcribing narration…");
      const tmp = resolveInProject(projectId, "media");
      await ensureDir(tmp);
      const asr = await transcribe(resolveInProject(projectId, project.mediaPath!), tmp, project.script);
      const aligned = project.script ? alignScriptToTranscript(project.script, asr) : undefined;
      await ctx.update("transcribing", 25, aligned ? "Aligning script to audio…" : "Transcript ready");

      const titleRes = await generateTitle(aligned ?? asr);
      project = await updateProject(projectId, (p) => {
        p.transcript = asr;
        p.alignedTranscript = aligned;
        p.generatedTitle = titleRes.title;
        if (!p.title || p.title === "Untitled project" || p.title === p.generatedTitle) p.title = titleRes.title;
        if (!p.mediaDuration) p.mediaDuration = asr.duration;
      });
    }

    await ctx.update("analyzing", 35, "Selecting important visual moments…");
    const transcript = project.alignedTranscript ?? project.transcript!;
    const moments = await analyzeMoments(transcript, project.frequency);
    await updateProject(projectId, (p) => {
      p.candidateMoments = moments;
    });

    const entries: TimelineEntry[] = [];
    for (const [i, m] of moments.entries()) {
      const frac = i / Math.max(moments.length, 1);
      await ctx.update("searching", 40 + frac * 40, `Searching images for moment ${i + 1}/${moments.length}…`);
      const entry = await buildEntry(projectId, m, project.mediaDuration);
      entries.push(entry);
      await ctx.update("selecting", 45 + frac * 40, `Ranked moment ${i + 1}/${moments.length}`);
    }
    await updateProject(projectId, (p) => {
      p.timeline = normalizeTimeline(entries);
      p.renderStatus = "idle";
      p.outputVideoPath = undefined;
      p.lastJobId = ctx.job.id;
    });
    await ctx.update("done", 100, `Timeline ready with ${entries.filter((e) => e.chosenCandidateId).length} visuals`);
  });
}

/** Re-run search+rank for selected entries (or all / low-confidence). */
export function startRegenerateJob(
  projectId: string,
  selector: { entryIds?: string[]; lowConfidenceBelow?: number; all?: boolean; queries?: string[] },
): JobState {
  return startJob("regenerate", projectId, async (ctx) => {
    const project = await requireProject(projectId);
    const targets = project.timeline.filter((e) => {
      if (e.removed) return false;
      if (selector.all) return true;
      if (selector.entryIds?.includes(e.id)) return true;
      if (selector.lowConfidenceBelow !== undefined)
        return e.status === "skipped" || e.confidence < selector.lowConfidenceBelow;
      return false;
    });
    for (const [i, e] of targets.entries()) {
      await ctx.update("searching", (i / Math.max(targets.length, 1)) * 90, `Re-searching ${i + 1}/${targets.length}…`);
      const moment = momentFromEntry(e);
      if (selector.queries?.length && selector.entryIds?.length === 1) {
        [moment.search_query_1, moment.search_query_2 = "", moment.search_query_3 = ""] = selector.queries;
      }
      const fresh = await buildEntry(projectId, moment, project.mediaDuration, e.id);
      await updateProject(projectId, (p) => {
        const idx = p.timeline.findIndex((t) => t.id === e.id);
        if (idx >= 0) {
          const manual = p.timeline[idx].candidates.filter((c) => c.manual);
          fresh.candidates = [...manual, ...fresh.candidates];
          fresh.start = p.timeline[idx].start;
          fresh.end = p.timeline[idx].end;
          fresh.searchQueries = selector.queries?.length ? selector.queries : fresh.searchQueries;
          p.timeline[idx] = fresh;
        }
        p.renderStatus = "idle";
      });
    }
  });
}

export async function renderProject(projectId: string, ctx: JobContext): Promise<void> {
  const project = await requireProject(projectId);
  await updateProject(projectId, (p) => {
    p.renderStatus = "rendering";
    p.renderError = undefined;
  });
  await ctx.update("rendering", 2, "Preparing render…");
  await ensureDir(resolveInProject(projectId, "renders"));
  const plan = await buildRenderPlan(project, project.renderSettings);
  try {
    await runFfmpeg(plan, (f) => void ctx.update("rendering", 2 + f * 96, `Encoding ${Math.round(f * 100)}%`));
  } catch (err) {
    await updateProject(projectId, (p) => {
      p.renderStatus = "error";
      p.renderError = (err as Error).message;
    });
    throw err;
  }
  await updateProject(projectId, (p) => {
    p.renderStatus = "done";
    p.outputVideoPath = plan.outputRel;
  });
}

export function startRenderJob(projectId: string): JobState {
  const job = startJob("render", projectId, (ctx) => renderProject(projectId, ctx));
  void updateProject(projectId, (p) => {
    p.renderStatus = "queued";
    p.renderJobId = job.id;
  });
  return job;
}

export function startAutoImageJob(projectId: string): JobState {
  return startJob("auto", projectId, async (ctx) => {
    const project = await requireProject(projectId);
    if (!project.mediaPath || !project.mediaDuration) throw new Error("Upload an audio/video file first");
    const query = mediaQueryFromFilename(project.mediaOriginalName ?? project.mediaPath);
    if (!query) throw new Error("Could not determine an image search query from the audio filename");

    await ctx.update("searching", 10, `Searching images for “${query}”…`);
    const moment: CandidateMoment = {
      start_time: 0,
      end_time: project.mediaDuration,
      transcript_excerpt: query,
      visual_priority_score: 1,
      why_visual_is_helpful: "Title image for the whole video",
      search_query_1: query,
      search_query_2: `${query} photo`,
      search_query_3: `${query} high resolution`,
      suggested_visual_type: "photo",
    };
    const { candidates } = await searchCandidates(moment);
    if (!candidates.length) throw new Error(`No images found for “${query}” — upload an image instead`);
    const downloaded = await downloadAndPrefilter(projectId, "auto", candidates);
    const large = downloaded.filter((c) => !c.rejected && c.localPath && (c.width ?? 0) * (c.height ?? 0) >= 1280 * 720);
    const preferred = large.length >= 3 ? downloaded.filter((c) => large.includes(c) || c.rejected) : downloaded;

    await ctx.update("selecting", 60, `Selecting the best image for “${query}”…`);
    const ranked = await rankCandidates(projectId, moment, preferred);
    const rankedCandidates = [
      ...ranked.candidates,
      ...downloaded.filter((c) => !ranked.candidates.some((rankedCandidate) => rankedCandidate.id === c.id)),
    ];
    const viable = rankedCandidates
      .filter((c) => !c.rejected && c.localPath)
      .sort((a, b) => (b.prefilterScore ?? 0) - (a.prefilterScore ?? 0));
    const chosen = ranked.chosenId ? ranked.chosenId : viable[0]?.id;
    if (!chosen) throw new Error(`No images found for “${query}” — upload an image instead`);
    const confidence = ranked.chosenId ? ranked.confidence : 0.3;
    const selected = rankedCandidates.find((c) => c.id === chosen);
    const updated = await updateProject(projectId, (p) => {
      p.timeline = [{
        id: "auto",
        start: 0,
        end: p.mediaDuration!,
        excerpt: query,
        reason: selected?.visionReason || `Best match for “${query}”`,
        visualType: "photo",
        priority: 1,
        confidence,
        status: "ok",
        searchQueries: [query, `${query} photo`, `${query} high resolution`],
        chosenCandidateId: chosen,
        candidates: rankedCandidates,
      }];
      p.renderStatus = "idle";
      p.outputVideoPath = undefined;
      p.lastJobId = ctx.job.id;
      if ((!p.title || p.title === "Untitled project") && p.mediaOriginalName) {
        p.title = path.basename(p.mediaOriginalName, path.extname(p.mediaOriginalName));
      }
    });
    log.info(`auto image selected for ${updated.id}`, { query, chosen, alternatives: Math.max(0, rankedCandidates.length - 1) });
    await renderProject(projectId, ctx);
  });
}

export function outputVideoAbsPath(project: Project): string | null {
  if (!project.outputVideoPath) return null;
  return resolveInProject(project.id, path.normalize(project.outputVideoPath));
}
