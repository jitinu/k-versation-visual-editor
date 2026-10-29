"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/client";
import { mediaQueryFromFilename } from "@/lib/query";
import type { JobState } from "@/lib/types";
import { Dropzone } from "./Dropzone";
import { ProgressBar } from "./ProgressBar";

type Item = {
  key: string;
  file: File;
  status: "waiting" | "uploading" | "working" | "done" | "error";
  uploadPct: number;
  projectId?: string;
  job?: JobState;
  error?: string;
};

const STAGES: JobState["stage"][] = ["uploading", "searching", "selecting", "rendering", "done"];
const CONCURRENCY = 2;

export function NewProjectForm() {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const patch = (key: string, changes: Partial<Item>) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...changes } : it)));

  const addFiles = (files: File[]) => {
    setError(null);
    setItems((prev) => {
      const known = new Set(prev.map((it) => `${it.file.name}:${it.file.size}`));
      const fresh = files
        .filter((f) => !known.has(`${f.name}:${f.size}`))
        .map((f) => ({ key: `${f.name}:${f.size}:${Date.now()}`, file: f, status: "waiting" as const, uploadPct: 0 }));
      return [...prev, ...fresh];
    });
  };

  const processItem = async (item: Item) => {
    try {
      patch(item.key, { status: "uploading", uploadPct: 0 });
      const project = await api.createProject({});
      const form = new FormData();
      form.append("media", item.file);
      await api.upload(project.id, form, (pct) => patch(item.key, { uploadPct: pct }));
      const { job } = await api.simpleRender(project.id);
      patch(item.key, { status: "working", projectId: project.id, job });
      let current = job;
      while (current.stage !== "done" && current.stage !== "error") {
        await new Promise((r) => setTimeout(r, 1500));
        current = await api.job(job.id);
        patch(item.key, { job: current });
      }
      patch(item.key, { status: current.stage === "done" ? "done" : "error", job: current, error: current.error });
    } catch (err) {
      patch(item.key, { status: "error", error: (err as Error).message });
    }
  };

  const start = async () => {
    const queue = itemsRef.current.filter((it) => it.status === "waiting" || it.status === "error");
    if (!queue.length) {
      setError("Add at least one narration file first.");
      return;
    }
    setBusy(true);
    setError(null);
    const pending = [...queue];
    const workers = Array.from({ length: Math.min(CONCURRENCY, pending.length) }, async () => {
      while (pending.length) await processItem(pending.shift()!);
    });
    await Promise.all(workers);
    setBusy(false);
  };

  const remove = (key: string) => setItems((prev) => prev.filter((it) => it.key !== key));
  const waiting = items.filter((it) => it.status === "waiting" || it.status === "error").length;
  const finished = items.filter((it) => it.status === "done").length;

  return (
    <div className="space-y-6">
      <div>
        <label className="label">Narration audio or video (one or many)</label>
        <Dropzone
          file={null}
          onFile={() => {}}
          multiple
          onFiles={addFiles}
          disabled={busy}
          label="Drop your recordings here, or click to browse"
        />
      </div>

      {items.length > 0 && (
        <ul className="space-y-3">
          {items.map((it) => (
            <li key={it.key} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-zinc-100">{mediaQueryFromFilename(it.file.name)}</div>
                  <div className="text-xs text-zinc-500">{it.file.name} · {(it.file.size / 1024 / 1024).toFixed(1)} MB</div>
                </div>
                <div className="flex gap-2">
                  {it.status === "done" && it.projectId && (
                    <>
                      <a className="btn btn-primary" href={`/api/projects/${it.projectId}/render?download=1`}>
                        Download MP4
                      </a>
                      <a className="btn btn-secondary" href={`/projects/${it.projectId}`}>
                        Open
                      </a>
                    </>
                  )}
                  {it.status === "waiting" && !busy && (
                    <button type="button" className="btn btn-ghost" onClick={() => remove(it.key)}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-3">
                {it.status === "waiting" && <p className="text-xs text-zinc-500">Waiting. Will search for “{mediaQueryFromFilename(it.file.name)}”.</p>}
                {it.status === "uploading" && (
                  <ProgressBar stage="uploading" progress={it.uploadPct * 100} message={`Uploading ${Math.round(it.uploadPct * 100)}%`} stages={STAGES} />
                )}
                {it.status === "working" && it.job && (
                  <ProgressBar stage={it.job.stage} progress={it.job.progress} message={it.job.message} stages={STAGES} />
                )}
                {it.status === "done" && <p className="text-xs text-emerald-300">Done. Cover image found and video rendered.</p>}
                {it.status === "error" && <p className="text-xs text-red-300">{it.error ?? "Something went wrong"}. Click Create videos to retry.</p>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-sm text-red-300">{error}</p>}

      <button type="button" className="btn btn-primary w-full py-3 text-base" onClick={start} disabled={busy || !waiting}>
        {busy
          ? `Working on ${items.length - finished} video${items.length - finished === 1 ? "" : "s"}…`
          : `Create ${waiting || ""} video${waiting === 1 ? "" : "s"}`.replace("  ", " ")}
      </button>
    </div>
  );
}
