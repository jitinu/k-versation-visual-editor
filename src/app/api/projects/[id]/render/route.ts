import { NextResponse } from "next/server";
import { renderProjectVideo } from "@/lib/export";
import { getProject } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Context {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const project = await renderProjectVideo(await getProject(id));
    return NextResponse.json(project, { status: project.status === "error" ? 500 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rendering failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
