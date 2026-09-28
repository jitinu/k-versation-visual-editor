import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { createLogger } from "./logger";
import type { JobStage, JobState } from "./types";
import { errorMessage, newId, nowIso } from "./util";
import { ensureDir } from "./storage/files";

const log = createLogger("jobs");

/**
 * Minimal background job runner. Jobs run in-process (fire-and-forget promise)
 * and their status is persisted to `<dataDir>/jobs/<id>.json` so status
 * polling survives module reloads in dev.
 */

type GlobalJobs = { jobs: Map<string, JobState> };
const g = globalThis as unknown as { __kvJobs?: GlobalJobs };
if (!g.__kvJobs) g.__kvJobs = { jobs: new Map() };
const store = g.__kvJobs;

function jobsDir(): string {
  return path.join(config.dataDir, "jobs");
}

async function persist(job: JobState): Promise<void> {
  await ensureDir(jobsDir());
  await fs.writeFile(path.join(jobsDir(), `${job.id}.json`), JSON.stringify(job, null, 2));
}

export async function getJob(id: string): Promise<JobState | null> {
  const mem = store.jobs.get(id);
  if (mem) return mem;
  try {
    const raw = await fs.readFile(path.join(jobsDir(), `${id}.json`), "utf8");
    const job = JSON.parse(raw) as JobState;
    // a persisted "running" job with no in-memory owner is orphaned (server restarted)
    if (job.stage !== "done" && job.stage !== "error") {
      job.stage = "error";
      job.error = "Job was interrupted by a server restart. Please retry.";
    }
    return job;
  } catch {
    return null;
  }
}

export interface JobContext {
  job: JobState;
  update: (stage: JobStage, progress: number, message?: string) => Promise<void>;
}

export function startJob(
  type: JobState["type"],
  projectId: string,
  run: (ctx: JobContext) => Promise<void>,
): JobState {
  const job: JobState = {
    id: newId("job"),
    type,
    projectId,
    stage: "queued",
    progress: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  store.jobs.set(job.id, job);
  void persist(job);

  const update = async (stage: JobStage, progress: number, message?: string) => {
    job.stage = stage;
    job.progress = Math.round(progress);
    job.message = message;
    job.updatedAt = nowIso();
    await persist(job);
  };

  // deferred so the HTTP response returns immediately
  setTimeout(() => {
    run({ job, update })
      .then(() => update("done", 100, "Complete"))
      .catch(async (err) => {
        log.error(`job ${job.id} failed`, err);
        job.error = errorMessage(err);
        await update("error", job.progress, job.error);
      });
  }, 0);

  log.info("started job", { id: job.id, type, projectId });
  return job;
}
