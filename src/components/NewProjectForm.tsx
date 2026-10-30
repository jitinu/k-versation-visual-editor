"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { JobState } from "@/lib/types";
import { Dropzone } from "./Dropzone";
import { ProgressBar } from "./ProgressBar";

type Item = {
  key: string;
  audio: File;
  image: File | null;
  status: "waiting" | "uploading" | "working" | "done" | "error";
  uploadPct: number;
  projectId?: string;
  job?: JobState;
  error?: string;
};

const STAGES: JobState["stage"][] = ["uploading", "rendering", "done"];
const CONCURRENCY = 2;

const stem = (name: string) => name.replace(/\.[^.]+$/, "");
const fileKey = (f: File) => `${f.name}:${f.size}`;

function Thumb({ file, onPick, disabled }: { file: File | null; onPick: (f: File) => void; disabled: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <button
      type="button"
      title={file ? `${file.name} (click to change)` : "Choose an image"}
      disabled={disabled}
      onClick={() => inputRef.current?.click()}
      className={`relative h-16 w-28 shrink-0 overflow-hidden rounded-md border text-xs ${
        file ? "border-zinc-700" : "border-dashed border-amber-500/60 text-amber-200"
      } ${disabled ? "cursor-default" : "hover:border-zinc-400"}`}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full items-center justify-center px-2 text-center leading-tight">Add image</span>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.jpg,.jpeg,.png,.webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && f.type.startsWith("image/")) onPick(f);
          e.target.value = "";
        }}
      />
    </button>
  );
}

export function NewProjectForm() {
  const [items, setItems] = useState<Item[]>([]);
  const [spareImages, setSpareImages] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const patch = (key: string, changes: Partial<Item>) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...changes } : it)));

  /** Pair image-less rows with loose images in the order they were added. */
  const pair = (rows: Item[], images: File[]): { rows: Item[]; leftover: File[] } => {
    const pool = [...images];
    const inOrder = [...rows].reverse();
    const next = inOrder.map((it) => (it.image || it.status !== "waiting" || !pool.length ? it : { ...it, image: pool.shift()! }));
    return { rows: next.reverse(), leftover: pool };
  };

  const addAudio = (files: File[]) => {
    setError(null);
    const known = new Set(items.map((it) => fileKey(it.audio)));
    const fresh = files
      .filter((f) => !f.type.startsWith("image/") && !known.has(fileKey(f)))
      .map<Item>((f) => ({ key: `${fileKey(f)}:${Date.now()}:${Math.random()}`, audio: f, image: null, status: "waiting", uploadPct: 0 }));
    const { rows, leftover } = pair([...fresh.reverse(), ...items], spareImages);
    setItems(rows);
    setSpareImages(leftover);
  };

  const addImages = (files: File[]) => {
    setError(null);
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (!images.length) {
      setError("Only image files go in the image box.");
      return;
    }
    const { rows, leftover } = pair(items, [...spareImages, ...images]);
    setItems(rows);
    setSpareImages(leftover);
  };

  const processItem = async (item: Item) => {
    if (!item.image) return;
    try {
      patch(item.key, { status: "uploading", uploadPct: 0, error: undefined });
      const project = await api.createProject({ title: stem(item.audio.name) });
      const form = new FormData();
      form.append("media", item.audio);
      await api.upload(project.id, form, (pct) => patch(item.key, { uploadPct: pct }));
      const { job } = await api.simpleRender(project.id, item.image);
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

  const ready = items.filter((it) => (it.status === "waiting" || it.status === "error") && it.image);
  const missing = items.filter((it) => it.status === "waiting" && !it.image).length;
  const finished = items.filter((it) => it.status === "done").length;

  const start = async () => {
    const queue = itemsRef.current.filter((it) => (it.status === "waiting" || it.status === "error") && it.image);
    if (!queue.length) {
      setError(items.length ? "Each audio needs an image. Drop images in the second box." : "Add at least one audio file first.");
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

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="label">Audio files (one or many)</label>
          <Dropzone file={null} onFile={() => {}} multiple onFiles={addAudio} disabled={busy} label="Drop audio files here, or click to browse" />
        </div>
        <div>
          <label className="label">Images (one per audio)</label>
          <Dropzone
            file={null}
            onFile={() => {}}
            multiple
            onFiles={addImages}
            disabled={busy}
            accept="image/*,.jpg,.jpeg,.png,.webp"
            label="Drop images here, or click to browse"
            onError={setError}
          />
        </div>
      </div>
      <p className="text-xs text-zinc-500">
        Images are paired with audio in order: first audio gets the first image, second gets the second. Click a thumbnail to swap one.
      </p>

      {items.length > 0 && (
        <ul className="space-y-3">
          {items.map((it) => {
            const locked = busy || it.status === "done" || it.status === "uploading" || it.status === "working";
            return (
              <li key={it.key} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="flex flex-wrap items-start gap-4">
                  <Thumb file={it.image} disabled={locked} onPick={(f) => patch(it.key, { image: f })} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-zinc-100">{stem(it.audio.name)}</div>
                    <div className="truncate text-xs text-zinc-500">
                      {it.audio.name} · {(it.audio.size / 1024 / 1024).toFixed(1)} MB
                      {it.image ? ` · ${it.image.name}` : ""}
                    </div>
                    <div className="mt-3">
                      {it.status === "waiting" && (
                        <p className={`text-xs ${it.image ? "text-zinc-500" : "text-amber-300"}`}>
                          {it.image ? "Ready." : "Needs an image."}
                        </p>
                      )}
                      {it.status === "uploading" && (
                        <ProgressBar stage="uploading" progress={it.uploadPct * 100} message={`Uploading ${Math.round(it.uploadPct * 100)}%`} stages={STAGES} />
                      )}
                      {it.status === "working" && it.job && (
                        <ProgressBar stage={it.job.stage} progress={it.job.progress} message={it.job.message} stages={STAGES} />
                      )}
                      {it.status === "done" && <p className="text-xs text-emerald-300">Done.</p>}
                      {it.status === "error" && <p className="text-xs text-red-300">{it.error ?? "Something went wrong"}. Click Create videos to retry.</p>}
                    </div>
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
                    {(it.status === "waiting" || it.status === "error") && !busy && (
                      <button type="button" className="btn btn-ghost" onClick={() => remove(it.key)}>
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {spareImages.length > 0 && (
        <p className="text-xs text-zinc-500">
          {spareImages.length} image{spareImages.length === 1 ? "" : "s"} waiting for audio: {spareImages.map((f) => f.name).join(", ")}
        </p>
      )}

      {error && <p className="text-sm text-red-300">{error}</p>}

      <button type="button" className="btn btn-primary w-full py-3 text-base" onClick={start} disabled={busy || !ready.length}>
        {busy
          ? `Working on ${items.length - finished} video${items.length - finished === 1 ? "" : "s"}…`
          : ready.length
            ? `Create ${ready.length} video${ready.length === 1 ? "" : "s"}`
            : missing
              ? "Add images to continue"
              : "Create videos"}
      </button>
    </div>
  );
}
