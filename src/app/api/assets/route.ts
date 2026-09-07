import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { resolveDataPath } from "@/lib/storage";

export const runtime = "nodejs";

const contentTypes: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function GET(request: Request) {
  try {
    const relativePath = new URL(request.url).searchParams.get("path");
    if (!relativePath) {
      return NextResponse.json({ error: "Missing asset path" }, { status: 400 });
    }
    const absolutePath = resolveDataPath(relativePath);
    const data = await readFile(absolutePath);
    return new NextResponse(data, {
      headers: {
        "Content-Type":
          contentTypes[path.extname(absolutePath).toLowerCase()] ??
          "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }
}
