import type { JobStage } from "@/lib/types";

const STAGES: Array<{ key: JobStage; label: string }> = [
  { key: "uploading", label: "Uploading" },
  { key: "transcribing", label: "Transcribing" },
  { key: "analyzing", label: "Analyzing" },
  { key: "searching", label: "Searching" },
  { key: "selecting", label: "Selecting" },
  { key: "rendering", label: "Rendering" },
];

export function ProgressBar({
  stage,
  progress,
  message,
  error,
  stages = STAGES,
}: {
  stage: JobStage;
  progress: number;
  message?: string;
  error?: string;
  stages?: Array<{ key: JobStage; label: string }>;
}) {
  const idx = stages.findIndex((s) => s.key === stage);
  return (
    <div className="space-y-2" aria-live="polite">
      <div className="flex flex-wrap gap-2 text-xs">
        {stages.map((s, i) => (
          <span
            key={s.key}
            className={`badge ${
              i < idx || stage === "done"
                ? "border-emerald-700 text-emerald-300"
                : i === idx
                  ? "border-amber-500 text-amber-300"
                  : "border-zinc-700 text-zinc-500"
            }`}
          >
            {s.label}
          </span>
        ))}
      </div>
      <div className="h-2 w-full overflow-hidden rounded bg-zinc-800">
        <div
          className={`h-full transition-all ${stage === "error" ? "bg-red-500" : "bg-amber-500"}`}
          style={{ width: `${Math.max(2, progress)}%` }}
        />
      </div>
      <div className={`text-xs ${error ? "text-red-300" : "text-zinc-400"}`}>{error ?? message ?? stage}</div>
    </div>
  );
}
