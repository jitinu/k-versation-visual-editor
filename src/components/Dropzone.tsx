"use client";

import { useRef, useState } from "react";

export const ACCEPT_MEDIA = ".mp3,.wav,.m4a,.mp4,.mov,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,video/mp4,video/quicktime";

/**
 * Drag-and-drop zone that also opens the native OS file picker on click / Enter
 * (a real <input type="file"> so files can come from anywhere in Finder).
 */
export function Dropzone({
  file,
  onFile,
  disabled,
}: {
  file: File | null;
  onFile: (f: File | null) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const pick = (list: FileList | null) => {
    const f = list?.[0];
    if (f) onFile(f);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload narration audio or video"
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled) {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) pick(e.dataTransfer.files);
      }}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition ${
        over ? "border-amber-400 bg-amber-500/10" : "border-zinc-700 bg-zinc-900/40 hover:border-zinc-500"
      } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_MEDIA}
        className="hidden"
        data-testid="media-input"
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = "";
        }}
      />
      {file ? (
        <>
          <div className="text-sm font-medium text-zinc-100">{file.name}</div>
          <div className="mt-1 text-xs text-zinc-400">{(file.size / 1024 / 1024).toFixed(1)} MB · click to choose a different file</div>
        </>
      ) : (
        <>
          <div className="text-sm font-medium text-zinc-100">Drop narration audio here, or click to browse</div>
          <div className="mt-1 text-xs text-zinc-400">mp3 · wav · m4a · mp4 · mov — up to 1 GB</div>
        </>
      )}
    </div>
  );
}
