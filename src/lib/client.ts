"use client";

import type { JobState, Project, ProjectSummary, VisualFrequency } from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  return body as T;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  listProjects: () => request<ProjectSummary[]>("/api/projects"),
  createProject: (body: { title?: string; frequency?: VisualFrequency; script?: string }) =>
    request<Project>("/api/projects", jsonInit("POST", body)),
  getProject: (id: string) => request<Project>(`/api/projects/${id}`),
  patchProject: (id: string, body: Record<string, unknown>) =>
    request<Project>(`/api/projects/${id}`, jsonInit("PATCH", body)),
  upload: (id: string, form: FormData, onProgress?: (fraction: number) => void) =>
    new Promise<Project>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/projects/${id}/upload`);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        try {
          const body = JSON.parse(xhr.responseText);
          if (xhr.status >= 400) reject(new Error(body.error ?? xhr.statusText));
          else resolve(body as Project);
        } catch (err) {
          reject(err);
        }
      };
      xhr.onerror = () => reject(new Error("Upload failed"));
      xhr.send(form);
    }),
  generate: (id: string, body: { frequency?: VisualFrequency; skipTranscription?: boolean }) =>
    request<{ job: JobState }>(`/api/projects/${id}/generate`, jsonInit("POST", body)),
  regenerate: (
    id: string,
    body: { entryIds?: string[]; all?: boolean; lowConfidenceBelow?: number; queries?: string[] },
  ) => request<{ job: JobState }>(`/api/projects/${id}/regenerate`, jsonInit("POST", body)),
  render: (id: string) => request<{ job: JobState }>(`/api/projects/${id}/render`, { method: "POST" }),
  job: (jobId: string) => request<JobState>(`/api/jobs/${jobId}`),
  patchEntry: (id: string, entryId: string, body: Record<string, unknown>) =>
    request<Project>(`/api/projects/${id}/entries/${entryId}`, jsonInit("PATCH", body)),
  uploadEntryImage: (id: string, entryId: string, file: File) => {
    const form = new FormData();
    form.append("image", file);
    return request<Project>(`/api/projects/${id}/entries/${entryId}/image`, { method: "POST", body: form });
  },
  config: () =>
    request<{ transcription: string; llm: string; vision: string; search: string[]; mock: boolean; warnings?: string[] }>("/api/config"),
};

export function fileUrl(projectId: string, rel: string): string {
  return `/api/projects/${projectId}/files/${rel.split(/[\\/]/).map(encodeURIComponent).join("/")}`;
}

/** Poll a job until it finishes; calls onUpdate on every tick. */
export async function pollJob(jobId: string, onUpdate: (job: JobState) => void, intervalMs = 1500): Promise<JobState> {
  for (;;) {
    const job = await api.job(jobId);
    onUpdate(job);
    if (job.stage === "done" || job.stage === "error") return job;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
