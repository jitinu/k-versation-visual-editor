import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  getProject,
  projectOwnsAsset,
  resolveDataPath,
} from "@/lib/storage";

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
    const normalizedPath = path.posix.normalize(
      relativePath.replaceAll("\\", "/"),
    );
    const [directory, projectId] = normalizedPath.split("/");
    if (directory !== "uploads" || !projectId) {
      throw new Error("Asset path is not publicly readable");
    }
    const project = await getProject(projectId);
    if (!projectOwnsAsset(project, normalizedPath)) {
      throw new Error("Asset is not referenced by this project");
    }
    const extension = path.extname(normalizedPath).toLowerCase();
    const contentType = contentTypes[extension];
    if (!contentType) {
      throw new Error("Unsupported asset type");
    }
    const absolutePath = resolveDataPath(normalizedPath);
    const data = await readFile(absolutePath);
    return new NextResponse(data, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }
}
