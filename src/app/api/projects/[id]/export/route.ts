import { HttpError, handleError, type Params } from "@/lib/api";
import { timelineToJson, transcriptToSrt, transcriptToText } from "@/lib/pipeline/srt";
import { requireProject } from "@/lib/storage/projects";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: Params<{ id: string }>) {
  try {
    const { id } = await params;
    const project = await requireProject(id);
    const type = new URL(req.url).searchParams.get("type");
    const transcript = project.alignedTranscript ?? project.transcript;
    const base = project.title.replace(/[^A-Za-z0-9 _-]/g, "").trim() || "project";
    const send = (body: string, name: string, mime: string) =>
      new Response(body, {
        headers: { "Content-Type": mime, "Content-Disposition": `attachment; filename="${name}"` },
      });

    switch (type) {
      case "transcript":
        if (!transcript) throw new HttpError(404, "No transcript yet");
        return send(transcriptToText(transcript), `${base}.txt`, "text/plain; charset=utf-8");
      case "srt":
        if (!transcript) throw new HttpError(404, "No transcript yet");
        return send(transcriptToSrt(transcript), `${base}.srt`, "application/x-subrip; charset=utf-8");
      case "timeline":
        return send(timelineToJson(project.timeline), `${base}.timeline.json`, "application/json");
      default:
        throw new HttpError(400, "type must be transcript | srt | timeline");
    }
  } catch (err) {
    return handleError(err);
  }
}
