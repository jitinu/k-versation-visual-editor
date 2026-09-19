import fs from "node:fs";
import path from "node:path";
import { HttpError, handleError, type Params } from "@/lib/api";
import { resolveInProject } from "@/lib/storage/files";
import { requireProject } from "@/lib/storage/projects";

export const runtime = "nodejs";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".mov": "video/quicktime",
};

/** Serve files that live inside a project directory (images/, renders/, media/). */
export async function GET(req: Request, { params }: Params<{ id: string; path: string[] }>) {
  try {
    const { id, path: parts } = await params;
    await requireProject(id);
    if (!["images", "renders", "media"].includes(parts[0])) throw new HttpError(403, "Forbidden");
    const abs = resolveInProject(id, parts.join("/"));
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new HttpError(404, "Not found");
    const stat = fs.statSync(abs);
    const mime = MIME[path.extname(abs).toLowerCase()] ?? "application/octet-stream";
    const range = req.headers.get("range");
    if (range && (mime.startsWith("video/") || mime.startsWith("audio/"))) {
      const [s, e] = range.replace("bytes=", "").split("-");
      const start = Number(s);
      const end = Math.min(e ? Number(e) : stat.size - 1, stat.size - 1);
      if (!Number.isFinite(start) || start < 0 || start > end) throw new HttpError(416, "Range not satisfiable");
      const fh = await fs.promises.open(abs, "r");
      const body = new Uint8Array(end - start + 1);
      try {
        await fh.read(body, 0, body.length, start);
      } finally {
        await fh.close();
      }
      return new Response(body, {
        status: 206,
        headers: {
          "Content-Type": mime,
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(end - start + 1),
        },
      });
    }
    return new Response(new Uint8Array(await fs.promises.readFile(abs)), {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(stat.size),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
