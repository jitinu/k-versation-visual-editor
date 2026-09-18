"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { parseCues } from "@/lib/pipeline/cues";
import { api } from "@/lib/client";
import { Dropzone } from "./Dropzone";
import { ImageListPicker } from "./ImageListPicker";
import { ProgressBar } from "./ProgressBar";

function imageKey(name: string): string {
  const base = name.split(/[\\/]/).pop()?.toLocaleLowerCase() ?? "";
  return base.replace(/\.[^.]+$/, "");
}

function imageRefExists(ref: string, images: File[]): boolean {
  const indexText = ref.startsWith("#") ? ref.slice(1) : ref;
  if (/^\d+$/.test(indexText)) return Number(indexText) >= 1 && Number(indexText) <= images.length;
  const lower = ref.toLocaleLowerCase();
  return images.some((file) => file.name.toLocaleLowerCase() === lower || imageKey(file.name) === imageKey(ref));
}

export function NewProjectForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [images, setImages] = useState<File[]>([]);
  const [script, setScript] = useState("");
  const [cues, setCues] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    api.config().then((c) => {
      setWarnings([
        ...(c.mock ? ["MOCK MODE: transcription/analysis use heuristics and placeholder images. Install faster-whisper + Ollama (free) or set OPENAI_API_KEY – see README."] : []),
        ...(c.warnings ?? []),
      ]);
    }).catch(() => undefined);
  }, []);

  const submit = async () => {
    if (!file) {
      setError("Choose a narration file first.");
      return;
    }
    if (!images.length) {
      setError("Choose at least one image.");
      return;
    }
    const cueText = cues.trim() || (images.length === 1 ? "0-end 1" : "");
    let parsed;
    try {
      parsed = parseCues(cueText);
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    if (!cues.trim() && images.length > 1) {
      setError("Add cues, or upload a single image to hold it for the whole video");
      return;
    }
    for (const cue of parsed) {
      if (!imageRefExists(cue.image, images)) {
        setError(`Line ${cue.line}: image "${cue.image}" is not in the uploaded image list`);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const project = await api.createProject({});
      const form = new FormData();
      form.append("media", file);
      await api.upload(project.id, form, setUploadPct);
      const { job } = await api.manualRender(project.id, { images, cues: cueText, script });
      router.push(`/projects/${project.id}?job=${job.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const usesTranscription = (() => {
    try {
      return parseCues(cues).some((cue) => cue.kind === "phrase");
    } catch {
      return Boolean(script.trim());
    }
  })();

  return (
    <div className="space-y-6">
      {warnings.map((warning) => (
        <div key={warning} className="rounded-md border border-amber-700/60 bg-amber-950/30 px-4 py-2 text-xs text-amber-200">
          {warning}
        </div>
      ))}

      <div>
        <label className="label">Narration audio or video</label>
        <Dropzone file={file} onFile={setFile} disabled={busy} />
      </div>

      <div>
        <label className="label">Images</label>
        <ImageListPicker
          files={images}
          onFiles={(next) => {
            setImages(next);
            setError(null);
          }}
          onRemove={(index) => setImages((current) => current.filter((_, i) => i !== index))}
          onError={setError}
          disabled={busy}
        />
      </div>

      <div>
        <label className="label" htmlFor="script">
          Script <span className="normal-case text-zinc-500">(optional — lets you place images by phrase)</span>
        </label>
        <textarea
          id="script"
          className="input min-h-28 font-mono text-xs"
          placeholder="Paste the narration script here…"
          value={script}
          onChange={(event) => setScript(event.target.value)}
          disabled={busy}
        />
      </div>

      <div>
        <label className="label" htmlFor="cues">Where each image goes</label>
        <textarea
          id="cues"
          className="input min-h-36 font-mono text-xs"
          placeholder={'0:00-0:05 1\n"Gwangjang Market" 2 6s\n0:30-end 3'}
          value={cues}
          onChange={(event) => setCues(event.target.value)}
          disabled={busy}
        />
        <div className="mt-2 space-y-1 text-xs text-zinc-400">
          <p>One cue per line. Use timestamps (<code>0:12-0:20 image.jpg</code>, <code>0:12 image.jpg 8s</code>) or quoted script phrases (<code>&quot;Gwangjang Market&quot; image.jpg</code>).</p>
          <p>Use <code>..</code>, <code>-</code>, or <code>to</code> between phrases. Image names are case-insensitive; <code>1</code>, <code>2</code>, and <code>#3</code> refer to upload order.</p>
        </div>
        {!cues.trim() && images.length !== 1 && <p className="mt-2 text-xs text-amber-300">Add cues, or upload a single image to hold it for the whole video</p>}
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}

      {busy ? (
        <ProgressBar
          stage="uploading"
          progress={uploadPct * 100}
          message={uploadPct < 1 ? `Uploading ${Math.round(uploadPct * 100)}%` : "Starting pipeline…"}
          stages={usesTranscription ? ["uploading", "transcribing", "rendering", "done"] : ["uploading", "rendering", "done"]}
        />
      ) : (
        <button type="button" className="btn btn-primary w-full py-3 text-base" onClick={submit} disabled={!file || !images.length}>
          Create video
        </button>
      )}
    </div>
  );
}
