"use client";

/* eslint-disable @next/next/no-img-element */
import { useRef, useState } from "react";

export function ImageListPicker({
  files,
  onFiles,
  onRemove,
  onError,
  disabled,
}: {
  files: File[];
  onFiles: (files: File[]) => void;
  onRemove: (index: number) => void;
  onError?: (message: string) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const addFiles = (list: FileList | File[]) => {
    const incoming = Array.from(list);
    const valid = incoming.filter((file) => file.type.startsWith("image/"));
    if (valid.length !== incoming.length) onError?.("Only image files are accepted");
    if (valid.length) onFiles([...files, ...valid]);
  };

  return (
    <div className="space-y-3">
      <div
        role="button"
        tabIndex={0}
        aria-label="Add images"
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && !disabled) {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          if (!disabled) addFiles(event.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center transition ${
          over ? "border-amber-400 bg-amber-500/10" : "border-zinc-700 bg-zinc-900/40 hover:border-zinc-500"
        } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*,.jpg,.jpeg,.png,.webp"
          multiple
          className="hidden"
          onChange={(event) => {
            addFiles(event.target.files ?? []);
            event.target.value = "";
          }}
        />
        <div className="text-sm font-medium text-zinc-100">Drop images here, or click to browse</div>
        <div className="mt-1 text-xs text-zinc-400">jpg · jpeg · png · webp — add as many as needed</div>
      </div>

      {files.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {files.map((file, index) => (
            <div key={`${file.name}-${index}`} className="flex items-center gap-3 rounded-md border border-zinc-800 bg-zinc-950/50 p-2">
              <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded bg-black">
                <img src={URL.createObjectURL(file)} alt="" className="h-full w-full object-cover" />
                <span className="absolute left-1 top-1 rounded bg-black/80 px-1.5 py-0.5 text-xs font-semibold text-white">{index + 1}</span>
              </div>
              <div className="min-w-0 flex-1 truncate text-sm text-zinc-200" title={file.name}>
                {file.name}
              </div>
              <button type="button" className="btn btn-ghost shrink-0" onClick={() => onRemove(index)} disabled={disabled}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
