"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { ProjectSummary } from "@/lib/types";

export function ProjectList() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listProjects().then(setProjects).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="text-sm text-red-300">{error}</p>;
  if (!projects) return <p className="text-sm text-zinc-500">Loading…</p>;
  if (!projects.length) return <p className="text-sm text-zinc-500">No projects yet.</p>;

  return (
    <ul className="space-y-2">
      {projects.map((p) => (
        <li key={p.id}>
          <Link href={`/projects/${p.id}`} className="card block py-3 hover:border-zinc-600">
            <div className="truncate text-sm font-medium">{p.title}</div>
            <div className="mt-1 flex items-center justify-between text-xs text-zinc-500">
              <span>{p.momentCount} visuals</span>
              <span>{p.renderStatus === "done" ? "rendered" : p.renderStatus}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
