import { NextResponse } from "next/server";
import {
  readRenderedFile,
  srtText,
  timelineJson,
  transcriptText,
} from "@/lib/export";
import { getProject } from "@/lib/storage";

export const runtime = "nodejs";

interface Context {
  params: Promise<{ id: string; kind: string }>;
}

export async function GET(_request: Request, context: Context) {
  try {
    const { id, kind } = await context.params;
    const project = await getProject(id);
    const safeTitle =
      project.title.replaceAll(/[^a-zA-Z0-9-_]+/g, "-").replaceAll(/^-+|-+$/g, "") ||
      "visual-story-maker";
    let body: string | Uint8Array<ArrayBuffer>;
    let contentType: string;
    let extension: string;
    if (kind === "transcript") {
      body = transcriptText(project);
      contentType = "text/plain; charset=utf-8";
      extension = "txt";
    } else if (kind === "srt") {
      body = srtText(project);
      contentType = "application/x-subrip; charset=utf-8";
      extension = "srt";
    } else if (kind === "timeline") {
      body = timelineJson(project);
      contentType = "application/json; charset=utf-8";
      extension = "json";
    } else if (kind === "video" && project.outputVideoPath) {
      body = Uint8Array.from(
        await readRenderedFile(project, "k-versation-export.mp4"),
      );
      contentType = "video/mp4";
      extension = "mp4";
    } else {
      return NextResponse.json({ error: "Export not available" }, { status: 404 });
    }
    return new NextResponse(body, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${safeTitle}.${extension}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Project or export not found" }, { status: 404 });
  }
}
