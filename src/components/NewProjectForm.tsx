"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Dropzone } from "./Dropzone";
import { ProgressBar } from "./ProgressBar";

export function NewProjectForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [image, setImage] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

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

  const submit = async () => {
    if (!file) {
      setError("Choose a narration file first.");
      return;
    }
    if (!image) {
      setError("Choose an image first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const project = await api.createProject({});
      const form = new FormData();
      form.append("media", file);
      await api.upload(project.id, form, setUploadPct);
      const { job } = await api.simpleRender(project.id, image);
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
        <label className="label">Image</label>
        <Dropzone
          file={image}
          onFile={setImage}
          disabled={busy}
          accept="image/*,.jpg,.jpeg,.png,.webp"
          label="Drop an image here, or click to browse"
        />
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}

      {busy ? (
        <ProgressBar
          stage="uploading"
          progress={uploadPct * 100}
          message={uploadPct < 1 ? `Uploading ${Math.round(uploadPct * 100)}%` : "Starting pipeline…"}
        />
      ) : (
        <button type="button" className="btn btn-primary w-full py-3 text-base" onClick={submit} disabled={!file || !image}>
          Create video
        </button>
      )}
    </div>
  );
}
