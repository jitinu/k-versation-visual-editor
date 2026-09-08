"use client";

/* eslint-disable @next/next/no-img-element */
import { useRef, useState } from "react";
import { fileUrl } from "@/lib/client";
import type { ImageCandidate, TimelineEntry } from "@/lib/types";
import { formatTime } from "@/lib/util";

export function TimelineEntryCard({
  projectId,
  entry,
  busy,
  onPatch,
  onRegenerate,
  onResearch,
  onUploadImage,
}: {
  projectId: string;
  entry: TimelineEntry;
  busy: boolean;
  onPatch: (body: Record<string, unknown>) => Promise<void>;
  onRegenerate: () => Promise<void>;
  onResearch: (queries: string[]) => Promise<void>;
  onUploadImage: (file: File) => Promise<void>;
}) {
  const [showAlts, setShowAlts] = useState(false);
  const [research, setResearch] = useState(false);
  const [queries, setQueries] = useState(entry.searchQueries.join("\n"));
  const [start, setStart] = useState(entry.start.toFixed(1));
  const [end, setEnd] = useState(entry.end.toFixed(1));
  const upload = useRef<HTMLInputElement>(null);

  const chosen = entry.candidates.find((c) => c.id === entry.chosenCandidateId);
  const alternatives = entry.candidates.filter((c) => c.id !== entry.chosenCandidateId && !c.rejected && c.localPath);
  const rejected = entry.candidates.filter((c) => c.rejected);
  const lowConfidence = entry.status !== "manual" && entry.confidence < 0.6;

  const commitTimes = async () => {
    const s = parseFloat(start);
    const e = parseFloat(end);
    if (Number.isNaN(s) || Number.isNaN(e)) return;
    if (s !== entry.start || e !== entry.end) await onPatch({ start: s, end: e });
  };

  const img = (c: ImageCandidate, cls: string) =>
    c.localPath ? <img src={fileUrl(projectId, c.localPath)} alt={c.title} className={cls} loading="lazy" /> : null;

  return (
    <article className={`card ${entry.removed ? "opacity-50" : ""}`} data-testid="timeline-entry">
      <div className="grid gap-4 md:grid-cols-[280px_1fr]">
        <div>
          <div className="aspect-video overflow-hidden rounded-md bg-black">
            {chosen?.localPath ? (
              img(chosen, "h-full w-full object-contain")
            ) : (
              <div className="flex h-full items-center justify-center px-4 text-center text-xs text-zinc-500">
                {entry.status === "skipped"
                  ? "Skipped — no confident image. Stays on black unless you pick one."
                  : "No image selected"}
              </div>
            )}
          </div>
          {chosen && (
            <div className="mt-2 text-xs text-zinc-400">
              <div className="truncate" title={chosen.title}>
                {chosen.title}
              </div>
              <div className="flex flex-wrap gap-x-2">
                {chosen.sourcePageUrl ? (
                  <a href={chosen.sourcePageUrl} target="_blank" rel="noreferrer" className="text-amber-300 hover:underline">
                    {chosen.sourceName || chosen.domain}
                  </a>
                ) : (
                  <span>{chosen.sourceName}</span>
                )}
                {chosen.width && chosen.height && <span>{chosen.width}×{chosen.height}</span>}
                {chosen.license && <span>{chosen.license}</span>}
              </div>
              {chosen.attribution && <div className="truncate text-zinc-500">© {chosen.attribution}</div>}
              {chosen.visionReason && <div className="mt-1 text-zinc-500">Vision: {chosen.visionReason}</div>}
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono text-sm text-zinc-200">
              {formatTime(entry.start)} – {formatTime(entry.end)}
            </span>
            <span className="badge border-zinc-700 text-zinc-300">{entry.visualType}</span>
            <span className="badge border-zinc-700 text-zinc-300">priority {Math.round(entry.priority * 100)}</span>
            <span
              className={`badge ${
                entry.status === "skipped"
                  ? "border-zinc-600 text-zinc-400"
                  : lowConfidence
                    ? "border-amber-700 text-amber-300"
                    : "border-emerald-700 text-emerald-300"
              }`}
            >
              {entry.status === "manual" ? "manual" : `confidence ${Math.round(entry.confidence * 100)}%`}
            </span>
            {entry.removed && <span className="badge border-red-800 text-red-300">removed</span>}
          </div>

          <blockquote className="border-l-2 border-zinc-700 pl-3 text-sm italic text-zinc-200">“{entry.excerpt}”</blockquote>
          <p className="text-xs text-zinc-400">
            <span className="font-medium text-zinc-300">Why a visual: </span>
            {entry.reason}
          </p>

          <div className="flex flex-wrap items-end gap-3 text-xs">
            <label className="flex flex-col">
              <span className="label">Start (s)</span>
              <input className="input w-24" value={start} onChange={(e) => setStart(e.target.value)} onBlur={commitTimes} disabled={busy} />
            </label>
            <label className="flex flex-col">
              <span className="label">End (s)</span>
              <input className="input w-24" value={end} onChange={(e) => setEnd(e.target.value)} onBlur={commitTimes} disabled={busy} />
            </label>
            <div className="pb-2 text-zinc-400">duration {(parseFloat(end) - parseFloat(start) || 0).toFixed(1)}s</div>
            <label className="flex items-center gap-1 pb-2 text-zinc-300">
              <input type="checkbox" checked={!!entry.kenBurns} onChange={(e) => onPatch({ kenBurns: e.target.checked })} disabled={busy} />
              Ken Burns
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="btn btn-secondary" onClick={() => setShowAlts((v) => !v)} disabled={busy || !alternatives.length}>
              {showAlts ? "Hide" : "See"} alternatives ({alternatives.length})
            </button>
            <button className="btn btn-secondary" onClick={onRegenerate} disabled={busy}>
              Regenerate
            </button>
            <button className="btn btn-secondary" onClick={() => setResearch((v) => !v)} disabled={busy}>
              Re-search…
            </button>
            <input
              ref={upload}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onUploadImage(f);
                e.target.value = "";
              }}
            />
            <button className="btn btn-secondary" onClick={() => upload.current?.click()} disabled={busy}>
              Upload image
            </button>
            {chosen && (
              <button className="btn btn-ghost" onClick={() => onPatch({ chosenCandidateId: null })} disabled={busy}>
                Clear image
              </button>
            )}
            <button className={entry.removed ? "btn btn-ghost" : "btn btn-danger"} onClick={() => onPatch({ removed: !entry.removed })} disabled={busy}>
              {entry.removed ? "Restore" : "Remove"}
            </button>
          </div>

          {research && (
            <div className="rounded-md border border-zinc-800 p-3">
              <label className="label" htmlFor={`q-${entry.id}`}>
                Search queries (one per line, up to 3)
              </label>
              <textarea id={`q-${entry.id}`} className="input min-h-20 font-mono text-xs" value={queries} onChange={(e) => setQueries(e.target.value)} />
              <div className="mt-2 flex gap-2">
                <button
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() =>
                    onResearch(
                      queries
                        .split("\n")
                        .map((q) => q.trim())
                        .filter(Boolean)
                        .slice(0, 3),
                    )
                  }
                >
                  Search with these queries
                </button>
                <button className="btn btn-ghost" onClick={() => setResearch(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {showAlts && (
            <div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {alternatives.map((c) => (
                  <button
                    key={c.id}
                    className="group overflow-hidden rounded-md border border-zinc-800 bg-black text-left hover:border-amber-500"
                    onClick={() => onPatch({ chosenCandidateId: c.id })}
                    disabled={busy}
                    title={`${c.title}\n${c.sourceName}${c.visionReason ? `\n${c.visionReason}` : ""}`}
                  >
                    <div className="aspect-video">{img(c, "h-full w-full object-cover")}</div>
                    <div className="truncate px-2 py-1 text-[11px] text-zinc-400 group-hover:text-zinc-200">
                      {c.visionScore !== undefined ? `${Math.round(c.visionScore * 100)}% · ` : ""}
                      {c.sourceName || c.domain}
                    </div>
                  </button>
                ))}
              </div>
              {rejected.length > 0 && (
                <details className="mt-2 text-xs text-zinc-500">
                  <summary className="cursor-pointer">{rejected.length} candidates filtered out</summary>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {rejected.slice(0, 20).map((c) => (
                      <li key={c.id} className="truncate">
                        {c.title} — {c.rejected}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
