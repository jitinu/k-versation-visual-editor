import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "@/lib/config";
import type { Project, ProjectSummary } from "@/lib/types";
import { assertSafeId } from "@/lib/utils";

const projectsDir = path.join(config.dataDir, "projects");
const uploadsDir = path.join(config.dataDir, "uploads");
const rendersDir = path.join(config.dataDir, "renders");
const cacheDir = path.join(config.dataDir, "cache");

export async function ensureDataDirectories(): Promise<void> {
  await Promise.all(
    [projectsDir, uploadsDir, rendersDir, cacheDir].map((directory) =>
      mkdir(directory, { recursive: true }),
    ),
  );
}

export function projectUploadDir(projectId: string): string {
  assertSafeId(projectId);
  return path.join(uploadsDir, projectId);
}

export function projectRenderDir(projectId: string): string {
  assertSafeId(projectId);
  return path.join(rendersDir, projectId);
}

export function projectCacheDir(projectId: string): string {
  assertSafeId(projectId);
  return path.join(cacheDir, projectId);
}

export async function getProject(projectId: string): Promise<Project> {
  assertSafeId(projectId);
  await ensureDataDirectories();
  const data = await readFile(path.join(projectsDir, `${projectId}.json`), "utf8");
  return JSON.parse(data) as Project;
}

export async function saveProject(project: Project): Promise<Project> {
  assertSafeId(project.id);
  await ensureDataDirectories();
  const updated = { ...project, updatedAt: new Date().toISOString() };
  const destination = path.join(projectsDir, `${project.id}.json`);
  const temporary = `${destination}.tmp`;
  await writeFile(temporary, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  await rename(temporary, destination);
  return updated;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  await ensureDataDirectories();
  const files = await readdir(projectsDir);
  const projects = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => {
        try {
          const project = JSON.parse(
            await readFile(path.join(projectsDir, file), "utf8"),
          ) as Project;
          return {
            id: project.id,
            title: project.title,
            status: project.status,
            duration: project.duration,
            visualCount: project.visuals.filter((visual) => !visual.removed).length,
            mediaOriginalName: project.mediaOriginalName,
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
          } satisfies ProjectSummary;
        } catch {
          return undefined;
        }
      }),
  );
  return projects
    .filter((project): project is ProjectSummary => project !== undefined)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function resolveDataPath(relativePath: string): string {
  const resolved = path.resolve(config.dataDir, relativePath);
  const prefix = `${config.dataDir}${path.sep}`;
  if (resolved !== config.dataDir && !resolved.startsWith(prefix)) {
    throw new Error("Path is outside the configured data directory");
  }
  return resolved;
}

export function toDataRelativePath(absolutePath: string): string {
  const resolved = path.resolve(absolutePath);
  const prefix = `${config.dataDir}${path.sep}`;
  if (!resolved.startsWith(prefix)) {
    throw new Error("Path is outside the configured data directory");
  }
  return path.relative(config.dataDir, resolved);
}
