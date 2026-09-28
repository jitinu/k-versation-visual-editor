import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config";
import type { Project, ProjectSummary, VisualFrequency } from "../types";
import { newId, nowIso } from "../util";
import { ensureDir, ensureProjectDirs, projectDir, projectsRoot } from "./files";
import { createLogger } from "../logger";

const log = createLogger("projects");

/**
 * Simple JSON-per-project persistence under `<dataDir>/projects/<id>/project.json`.
 * Suitable for personal use; swap for Supabase/SQLite by re-implementing this module.
 */

function projectFile(id: string): string {
  return path.join(projectDir(id), "project.json");
}

// serialise writes per project to avoid clobbering concurrent updates
const locks = new Map<string, Promise<unknown>>();
async function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(id, next.catch(() => undefined));
  try {
    return await next;
  } finally {
    if (locks.get(id) === next) locks.delete(id);
  }
}

export async function createProject(input: {
  title?: string;
  frequency?: VisualFrequency;
  script?: string;
}): Promise<Project> {
  const id = newId("prj");
  await ensureProjectDirs(id);
  const now = nowIso();
  const project: Project = {
    id,
    title: input.title?.trim() || "Untitled project",
    script: input.script?.trim() || undefined,
    frequency: input.frequency ?? "minimal",
    timeline: [],
    renderStatus: "idle",
    renderSettings: {
      width: config.render.width,
      height: config.render.height,
      kenBurns: config.render.kenBurns,
      burnSubtitles: config.render.burnSubtitles,
      fadeDuration: config.render.fadeDuration,
    },
    createdAt: now,
    updatedAt: now,
  };
  await writeProject(project);
  log.info("created project", { id });
  return project;
}

async function writeProject(project: Project): Promise<void> {
  const file = projectFile(project.id);
  await ensureDir(path.dirname(file));
  const tmp = file + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(project, null, 2));
  await fs.rename(tmp, file);
}

export async function getProject(id: string): Promise<Project | null> {
  try {
    const raw = await fs.readFile(projectFile(id), "utf8");
    return JSON.parse(raw) as Project;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function requireProject(id: string): Promise<Project> {
  const p = await getProject(id);
  if (!p) throw new NotFoundError(`Project ${id} not found`);
  return p;
}

export class NotFoundError extends Error {}

export async function updateProject(
  id: string,
  mutate: (p: Project) => void | Project | Promise<void | Project>,
): Promise<Project> {
  return withLock(id, async () => {
    const current = await requireProject(id);
    const result = (await mutate(current)) ?? current;
    result.updatedAt = nowIso();
    await writeProject(result);
    return result;
  });
}

export async function listProjects(): Promise<ProjectSummary[]> {
  await ensureDir(projectsRoot());
  const entries = await fs.readdir(projectsRoot(), { withFileTypes: true });
  const out: ProjectSummary[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const p = await getProject(e.name).catch(() => null);
    if (!p) continue;
    out.push({
      id: p.id,
      title: p.title,
      renderStatus: p.renderStatus,
      momentCount: p.timeline.filter((t) => !t.removed).length,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    });
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
