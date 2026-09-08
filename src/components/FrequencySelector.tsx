"use client";

import type { VisualFrequency } from "@/lib/types";

const OPTIONS: Array<{ value: VisualFrequency; label: string; hint: string }> = [
  { value: "minimal", label: "Minimal", hint: "~4–10 visuals for a 3–8 min narration (default)" },
  { value: "balanced", label: "Balanced", hint: "Roughly one visual every 25–40s" },
  { value: "frequent", label: "Frequent", hint: "One visual every 15–25s" },
];

export function FrequencySelector({
  value,
  onChange,
  disabled,
}: {
  value: VisualFrequency;
  onChange: (v: VisualFrequency) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Visual frequency">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`rounded-md border px-3 py-2 text-left transition ${
            value === o.value
              ? "border-amber-500 bg-amber-500/10"
              : "border-zinc-700 bg-zinc-900 hover:border-zinc-500"
          } disabled:opacity-50`}
        >
          <div className="text-sm font-medium">{o.label}</div>
          <div className="text-xs text-zinc-400">{o.hint}</div>
        </button>
      ))}
    </div>
  );
}
