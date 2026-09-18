import path from "node:path";
import { createLogger } from "../logger";
import { startJob, type JobContext } from "../jobs";
import { requireProject, updateProject } from "../storage/projects";
import { ensureDir, resolveInProject } from "../storage/files";
import type { CandidateMoment, JobState, Project, TimelineEntry, VisualFrequency } from "../types";
import { alignScriptToTranscript } from "./align";
import { analyzeMoments } from "./analyze";
import { parseCues, resolveCues } from "./cues";
import { downloadAndPrefilter } from "./images";
import { rankCandidates } from "./rank";
import { buildRenderPlan, runFfmpeg } from "./render";
import { searchCandidates } from "./search";
import { entryFromMoment, normalizeTimeline } from "./timeline";
import { generateTitle } from "./title";
import { transcribe } from "./transcribe";

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

export function startManualJob(projectId: string, opts: { cues: string; script?: string }): JobState {
  const job = startJob("manual", projectId, async (ctx) => {
    let project = await requireProject(projectId);
    if (!project.mediaPath || !project.mediaDuration) throw new Error("Upload an audio/video file first");
    const mediaDuration = project.mediaDuration;
    const cues = parseCues(opts.cues);
    const hasPhraseCues = cues.some((cue) => cue.kind === "phrase");
    const suppliedScript = opts.script?.trim() || undefined;
    const scriptChanged = suppliedScript !== undefined && suppliedScript !== (project.alignedTranscript?.text ?? "");
    if (hasPhraseCues && (!project.transcript || scriptChanged)) {
      await ctx.update("transcribing", 5, "Transcribing narration…");
      const tmp = resolveInProject(projectId, "media");
      await ensureDir(tmp);
      const asr = await transcribe(resolveInProject(projectId, project.mediaPath), tmp, suppliedScript);
      const aligned = suppliedScript ? alignScriptToTranscript(suppliedScript, asr) : undefined;
      await ctx.update("transcribing", 25, aligned ? "Aligning script to audio…" : "Transcript ready");
      project = await updateProject(projectId, (p) => {
        p.transcript = asr;
        p.alignedTranscript = aligned;
        if (suppliedScript !== undefined) p.script = suppliedScript;
        if (!p.mediaDuration) p.mediaDuration = asr.duration;
      });
    }
    const transcript = project.alignedTranscript ?? project.transcript;
    const resolved = resolveCues(cues, (project.manualImages ?? []).map((image) => image.title), mediaDuration, transcript);
    const imageByName = new Map((project.manualImages ?? []).map((image) => [image.title, image]));
    const entries: TimelineEntry[] = resolved.map((cue) => {
      const image = imageByName.get(cue.image);
      if (!image) throw new Error(`Line ${cue.line}: image "${cue.image}" was not uploaded`);
      const sourceCue = cues.find((candidate) => candidate.line === cue.line);
      return {
        id: `manual_${cue.line}_${Math.random().toString(36).slice(2, 8)}`,
        start: cue.start,
        end: cue.end,
        excerpt: sourceCue?.kind === "phrase" ? sourceCue.phrase : "",
        reason: `Manual cue (line ${cue.line})`,
        visualType: "photo",
        priority: 1,
        confidence: 1,
        status: "manual",
        searchQueries: [],
        chosenCandidateId: image.id,
        candidates: [image],
      };
    });
    await updateProject(projectId, (p) => {
      p.timeline = entries;
      p.renderStatus = "idle";
      p.outputVideoPath = undefined;
      p.lastJobId = ctx.job.id;
      if ((!p.title || p.title === "Untitled project") && p.mediaOriginalName) {
        p.title = path.basename(p.mediaOriginalName, path.extname(p.mediaOriginalName));
      }
    });
    await renderProject(projectId, ctx);
  });
  void updateProject(projectId, (p) => {
    p.renderStatus = "queued";
    p.renderJobId = job.id;
    p.lastJobId = job.id;
  });
  return job;
}

export function outputVideoAbsPath(project: Project): string | null {
  if (!project.outputVideoPath) return null;
  return resolveInProject(project.id, path.normalize(project.outputVideoPath));
}
