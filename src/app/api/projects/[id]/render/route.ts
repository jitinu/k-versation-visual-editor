import fs from "node:fs";
import { HttpError, handleError, json, type Params } from "@/lib/api";
import { outputVideoAbsPath, startRenderJob } from "@/lib/pipeline";
import { requireProject } from "@/lib/storage/projects";
import { getJob } from "@/lib/jobs";

export const runtime = "nodejs";

/** Start a background render job. */
export async function POST(_req: Request, { params }: Params<{ id: string }>) {
  try {
    const { id } = await params;
    const project = await requireProject(id);
    if (!project.mediaPath) throw new HttpError(400, "Project has no media");
    if (project.renderStatus === "rendering" || project.renderStatus === "queued") {
      const job = project.renderJobId ? await getJob(project.renderJobId) : null;
      if (job && job.stage !== "error" && job.stage !== "done") throw new HttpError(409, "A render is already running");
    }
    const job = startRenderJob(id);
    return json({ job }, 202);
  } catch (err) {
    return handleError(err);
  }
}

/** Render status; `?download=1` streams the finished MP4. */
export async function GET(req: Request, { params }: Params<{ id: string }>) {
  try {
    const { id } = await params;
    const project = await requireProject(id);
    const url = new URL(req.url);
    if (url.searchParams.get("download")) {
      const abs = outputVideoAbsPath(project);
      if (!abs || project.renderStatus !== "done" || !fs.existsSync(abs)) throw new HttpError(404, "No rendered video yet");
      const stat = fs.statSync(abs);
      const name = `${project.title.replace(/[^A-Za-z0-9 _-]/g, "").trim() || "render"}.mp4`;
      return new Response(new Uint8Array(await fs.promises.readFile(abs)), {
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(stat.size),
          "Content-Disposition": `attachment; filename="${name}"`,
        },
      });
    }
    const job = project.renderJobId ? await getJob(project.renderJobId) : null;
    return json({
      renderStatus: project.renderStatus,
      renderError: project.renderError,
      outputVideoPath: project.outputVideoPath,
      job,
    });
  } catch (err) {
    return handleError(err);
  }
}
