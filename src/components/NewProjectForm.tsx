"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { VisualFrequency } from "@/lib/types";
import { Dropzone } from "./Dropzone";
import { FrequencySelector } from "./FrequencySelector";
import { ProgressBar } from "./ProgressBar";

export function NewProjectForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [script, setScript] = useState("");
  const [frequency, setFrequency] = useState<VisualFrequency>("minimal");
  const [busy, setBusy] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const scriptInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .config()
      .then((c) =>
        setWarnings([
          ...(c.mock
            ? [
                "MOCK MODE: transcription/analysis use heuristics and placeholder images. Install faster-whisper + Ollama (free) or set OPENAI_API_KEY – see README.",
              ]
            : []),
          ...(c.warnings ?? []),
        ]),
      )
      .catch(() => undefined);
  }, []);

  const onScriptFile = async (f: File | undefined) => {
    if (!f) return;
    setScript(await f.text());
  };

  const submit = async () => {
    if (!file) {
      setError("Choose a narration file first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const project = await api.createProject({ title: title || undefined, frequency, script: script || undefined });
      const form = new FormData();
      form.append("media", file);
      if (script.trim()) form.append("script", script);
      await api.upload(project.id, form, setUploadPct);
      const { job } = await api.generate(project.id, { frequency });
      router.push(`/projects/${project.id}?job=${job.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {warnings.map((w) => (
        <div key={w} className="rounded-md border border-amber-700/60 bg-amber-950/30 px-4 py-2 text-xs text-amber-200">
          {w}
        </div>
      ))}

      <div>
        <label className="label">Narration audio or video</label>
        <Dropzone file={file} onFile={setFile} disabled={busy} />
      </div>

      <div>
        <label className="label" htmlFor="title">
          Project title <span className="normal-case text-zinc-500">(optional — auto-generated after transcription)</span>
        </label>
        <input
          id="title"
          className="input"
          placeholder="Leave blank to let the AI title it"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={busy}
        />
      </div>

      <div className="card border-amber-900/40">
        <div className="flex items-center justify-between">
          <label className="label mb-0" htmlFor="script">
            Script <span className="normal-case text-amber-300/90">(optional, but improves accuracy)</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              ref={scriptInput}
              type="file"
              accept=".txt,.md,.srt,text/plain"
              className="hidden"
              onChange={(e) => onScriptFile(e.target.files?.[0])}
            />
            <button type="button" className="btn btn-ghost" onClick={() => scriptInput.current?.click()} disabled={busy}>
              Upload .txt
            </button>
            {script && (
              <button type="button" className="btn btn-ghost" onClick={() => setScript("")} disabled={busy}>
                Clear
              </button>
            )}
          </div>
        </div>
        <p className="mt-1 text-xs text-zinc-400">
          If you paste the narration script, it is aligned word-by-word to the real audio so timestamps stay exact
          and names/places are spelled correctly.
        </p>
        <textarea
          id="script"
          className="input mt-3 min-h-32 font-mono text-xs"
          placeholder="Paste the narration script here…"
          value={script}
          onChange={(e) => setScript(e.target.value)}
          disabled={busy}
        />
      </div>

      <div>
        <label className="label">Visual frequency</label>
        <FrequencySelector value={frequency} onChange={setFrequency} disabled={busy} />
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}

      {busy ? (
        <ProgressBar
          stage="uploading"
          progress={uploadPct * 100}
          message={uploadPct < 1 ? `Uploading ${Math.round(uploadPct * 100)}%` : "Starting pipeline…"}
        />
      ) : (
        <button type="button" className="btn btn-primary w-full py-3 text-base" onClick={submit} disabled={!file}>
          Generate Visual Timeline
        </button>
      )}
    </div>
  );
}
