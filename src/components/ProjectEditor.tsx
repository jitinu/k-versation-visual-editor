"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, fileUrl, pollJob } from "@/lib/client";
import type { JobState, Project, VisualFrequency } from "@/lib/types";
import { formatTime } from "@/lib/util";
import { FrequencySelector } from "./FrequencySelector";
import { ProgressBar } from "./ProgressBar";
import { TimelineEntryCard } from "./TimelineEntryCard";

const RENDER_STAGES = [{ key: "rendering" as const, label: "Rendering MP4" }];

export function ProjectEditor({ projectId, initialJobId }: { projectId: string; initialJobId?: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [renderJob, setRenderJob] = useState<JobState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [frequency, setFrequency] = useState<VisualFrequency>("minimal");
  const [showTranscript, setShowTranscript] = useState(false);
  const titleDirty = useRef(false);

  const refresh = useCallback(async () => {
    const p = await api.getProject(projectId);
    setProject(p);
    setFrequency(p.frequency);
    if (!titleDirty.current) setTitle(p.title);
    return p;
  }, [projectId]);

  const watch = useCallback(
    async (j: JobState, setter: (j: JobState) => void) => {
      setter(j);
      const final = await pollJob(j.id, (u) => {
        setter(u);
        if (u.stage === "transcribing" || u.stage === "analyzing") void refresh();
      });
      await refresh();
      if (final.stage === "error") setError(final.error ?? "Job failed");
      return final;
    },
    [refresh],
  );

  useEffect(() => {
    refresh()
      .then((p) => {
        if (initialJobId) api.job(initialJobId).then((j) => watch(j, setJob)).catch(() => undefined);
        else if (p.lastJobId)
          api
            .job(p.lastJobId)
            .then((j) => {
              if (j.stage !== "done" && j.stage !== "error") void watch(j, setJob);
            })
            .catch(() => undefined);
        if (p.renderJobId && (p.renderStatus === "rendering" || p.renderStatus === "queued"))
          api.job(p.renderJobId).then((j) => watch(j, setRenderJob)).catch(() => undefined);
      })
      .catch((e) => setError(e.message));
  }, [refresh, watch, initialJobId]);

  const busy = !!job && job.stage !== "done" && job.stage !== "error";
  const rendering = !!renderJob && renderJob.stage !== "done" && renderJob.stage !== "error";

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const saveTitle = () =>
    run(async () => {
      titleDirty.current = false;
      if (project && title.trim() && title !== project.title) setProject(await api.patchProject(projectId, { title }));
    });

  const generate = (opts: { frequency?: VisualFrequency; skipTranscription?: boolean }) =>
    run(async () => {
      const { job } = await api.generate(projectId, opts);
      await watch(job, setJob);
    });

  const regenerate = (body: Parameters<typeof api.regenerate>[1]) =>
    run(async () => {
      const { job } = await api.regenerate(projectId, body);
      await watch(job, setJob);
    });

  const render = () =>
    run(async () => {
      const { job } = await api.render(projectId);
      await watch(job, setRenderJob);
    });

  const patchEntry = (entryId: string, body: Record<string, unknown>) =>
    run(async () => setProject(await api.patchEntry(projectId, entryId, body)));

  if (!project) return <p className="text-sm text-zinc-500">{error ?? "Loading project…"}</p>;

  const transcript = project.alignedTranscript ?? project.transcript;
  const active = project.timeline.filter((t) => !t.removed);
  const withImage = active.filter((t) => t.chosenCandidateId);
  const lowConf = active.filter((t) => t.status !== "manual" && (t.status === "skipped" || t.confidence < 0.6));
  const dl = (type: string) => `/api/projects/${projectId}/export?type=${type}`;

  return (
    <div className="space-y-8">
      <section className="card space-y-4">
        <div className="grid gap-4 md:grid-cols-[1fr_auto]">
          <div>
            <label className="label" htmlFor="title">
              Project title{" "}
              {project.generatedTitle && <span className="normal-case text-zinc-500">(AI suggested: “{project.generatedTitle}”)</span>}
            </label>
            <input
              id="title"
              className="input text-lg font-semibold"
              value={title}
              onChange={(e) => {
                titleDirty.current = true;
                setTitle(e.target.value);
              }}
              onBlur={saveTitle}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              placeholder={busy ? "Title will be generated after transcription…" : "Untitled project"}
            />
          </div>
          <div className="text-xs text-zinc-400 md:text-right">
            <div>{project.mediaOriginalName ?? "no media"}</div>
            {project.mediaDuration ? <div>{formatTime(project.mediaDuration)} long</div> : null}
            <div>saved {new Date(project.updatedAt).toLocaleString()}</div>
          </div>
        </div>

        {project.mediaPath && (
          <audio controls preload="none" className="w-full" src={fileUrl(projectId, project.mediaPath)} />
        )}

        {job && job.stage !== "done" && (
          <ProgressBar stage={job.stage} progress={job.progress} message={job.message} error={job.error} />
        )}
        {job?.stage === "done" && job.message && <p className="text-xs text-emerald-300">{job.message}</p>}
        {error && <p className="text-sm text-red-300">{error}</p>}
      </section>

      {project.timeline.length > 0 || transcript ? (
        <>
          <section className="card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold">
                Visual timeline{" "}
                <span className="text-sm font-normal text-zinc-400">
                  {withImage.length} visuals · {active.length - withImage.length} skipped
                </span>
              </h2>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-secondary" disabled={busy} onClick={() => regenerate({ all: true })}>
                  Regenerate all images
                </button>
                <button className="btn btn-secondary" disabled={busy || !lowConf.length} onClick={() => regenerate({ lowConfidenceBelow: 0.6 })}>
                  Regenerate low-confidence ({lowConf.length})
                </button>
                <button className="btn btn-secondary" disabled={busy} onClick={() => generate({ skipTranscription: true, frequency })}>
                  Re-select moments
                </button>
              </div>
            </div>
            <div>
              <label className="label">Visual frequency (change + rerun analysis, transcript is kept)</label>
              <FrequencySelector
                value={frequency}
                disabled={busy}
                onChange={(f) => {
                  setFrequency(f);
                  void generate({ frequency: f, skipTranscription: true });
                }}
              />
            </div>
          </section>

          <section className="space-y-4">
            {project.timeline.length === 0 && !busy && (
              <p className="text-sm text-zinc-500">No moments selected yet.</p>
            )}
            {project.timeline.map((entry) => (
              <TimelineEntryCard
                key={entry.id}
                projectId={projectId}
                entry={entry}
                busy={busy}
                onPatch={(body) => patchEntry(entry.id, body)}
                onRegenerate={() => regenerate({ entryIds: [entry.id] })}
                onResearch={(queries) => regenerate({ entryIds: [entry.id], queries })}
                onUploadImage={(file) => run(async () => setProject(await api.uploadEntryImage(projectId, entry.id, file)))}
              />
            ))}
          </section>

          <section className="card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Export</h2>
              <div className="flex flex-wrap gap-2 text-xs text-zinc-300">
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={project.renderSettings.kenBurns}
                    disabled={rendering}
                    onChange={(e) => run(async () => setProject(await api.patchProject(projectId, { renderSettings: { kenBurns: e.target.checked } })))}
                  />
                  Ken Burns on all
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={project.renderSettings.burnSubtitles}
                    disabled={rendering}
                    onChange={(e) => run(async () => setProject(await api.patchProject(projectId, { renderSettings: { burnSubtitles: e.target.checked } })))}
                  />
                  Burn subtitles
                </label>
                <span className="text-zinc-500">
                  {project.renderSettings.width}×{project.renderSettings.height}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-primary" disabled={busy || rendering || !project.mediaPath} onClick={render}>
                {project.renderStatus === "done" ? "Re-render video" : "Export Video (MP4)"}
              </button>
              {project.renderStatus === "done" && (
                <a className="btn btn-secondary" href={`/api/projects/${projectId}/render?download=1`}>
                  Download MP4
                </a>
              )}
              <a className="btn btn-secondary" href={dl("transcript")}>
                Download Transcript
              </a>
              <a className="btn btn-secondary" href={dl("srt")}>
                Download SRT
              </a>
              <a className="btn btn-secondary" href={dl("timeline")}>
                Download Timeline JSON
              </a>
            </div>
            {renderJob && renderJob.stage !== "done" && (
              <ProgressBar stage={renderJob.stage} progress={renderJob.progress} message={renderJob.message} error={renderJob.error} stages={RENDER_STAGES} />
            )}
            {project.renderStatus === "error" && project.renderError && <p className="text-sm text-red-300">{project.renderError}</p>}
            {project.renderStatus === "done" && project.outputVideoPath && (
              <video controls className="w-full rounded-md bg-black" src={fileUrl(projectId, project.outputVideoPath)} />
            )}
          </section>

          {transcript && (
            <section className="card">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">
                  Transcript{" "}
                  <span className="text-xs font-normal text-zinc-500">
                    {transcript.provider}
                    {transcript.alignedFromScript ? " · script aligned to audio" : ""} · {transcript.words.length} words
                  </span>
                </h2>
                <button className="btn btn-ghost" onClick={() => setShowTranscript((v) => !v)}>
                  {showTranscript ? "Hide" : "Show"}
                </button>
              </div>
              {showTranscript && (
                <ol className="mt-3 max-h-96 space-y-1 overflow-auto text-sm">
                  {transcript.segments.map((s) => (
                    <li key={s.id} className="flex gap-3">
                      <span className="w-12 shrink-0 font-mono text-xs text-zinc-500">{formatTime(s.start)}</span>
                      <span className="text-zinc-200">{s.text}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}
        </>
      ) : (
        !busy && (
          <section className="card">
            <p className="text-sm text-zinc-400">Nothing generated yet.</p>
            <button className="btn btn-primary mt-3" onClick={() => generate({ frequency })} disabled={!project.mediaPath}>
              Generate Visual Timeline
            </button>
          </section>
        )
      )}
    </div>
  );
}
