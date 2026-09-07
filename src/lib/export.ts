import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "@/lib/config";
import {
  projectCacheDir,
  projectRenderDir,
  resolveDataPath,
  saveProject,
  toDataRelativePath,
} from "@/lib/storage";
import type { ImageCandidate, Project } from "@/lib/types";
import { formatSrtTimestamp, retry } from "@/lib/utils";

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const process = spawn(config.ffmpegPath, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    process.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 16_000) stderr = stderr.slice(-16_000);
    });
    process.on("error", reject);
    process.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `FFmpeg exited with code ${code}`));
    });
  });
}

function chosenImage(project: Project, imageId?: string): ImageCandidate | undefined {
  if (!imageId) return undefined;
  return project.visuals
    .flatMap((visual) => visual.candidates)
    .find((image) => image.id === imageId);
}

async function cacheImage(
  projectId: string,
  candidate: ImageCandidate,
  index: number,
): Promise<string> {
  if (candidate.localPath) {
    return resolveDataPath(candidate.localPath);
  }
  const url = new URL(candidate.imageUrl);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Unsupported image URL");
  }
  const directory = projectCacheDir(projectId);
  await mkdir(directory, { recursive: true });
  const destination = path.join(directory, `visual-${index}.jpg`);
  const response = await retry(
    () =>
      fetch(candidate.imageUrl, {
        headers: { "User-Agent": "K-VERSATION/1.0 (personal visual editor)" },
      }),
    3,
    500,
  );
  if (!response.ok) {
    throw new Error(`Could not download selected image (${response.status})`);
  }
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > 25 * 1024 * 1024) {
    throw new Error("Selected image is too large");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 25 * 1024 * 1024) {
    throw new Error("Selected image is too large");
  }
  await writeFile(destination, bytes);
  return destination;
}

export function transcriptText(project: Project): string {
  return project.transcript
    .map(
      (segment) =>
        `[${formatSrtTimestamp(segment.start).replace(",", ".")} --> ${formatSrtTimestamp(segment.end).replace(",", ".")}] ${segment.text}`,
    )
    .join("\n");
}

export function srtText(project: Project): string {
  return project.transcript
    .map(
      (segment, index) =>
        `${index + 1}\n${formatSrtTimestamp(segment.start)} --> ${formatSrtTimestamp(segment.end)}\n${segment.text}\n`,
    )
    .join("\n");
}

export function timelineJson(project: Project): string {
  return `${JSON.stringify(
    {
      projectId: project.id,
      title: project.title,
      duration: project.duration,
      visualFrequency: project.visualFrequency,
      visuals: project.visuals
        .filter((visual) => !visual.removed)
        .map((visual) => ({
          startTime: visual.startTime,
          endTime: visual.endTime,
          transcriptExcerpt: visual.transcriptExcerpt,
          reason: visual.whyVisualIsHelpful,
          confidence: visual.confidence,
          visualType: visual.suggestedVisualType,
          chosenImage: chosenImage(project, visual.chosenImageId),
          alternatives: visual.candidates.filter(
            (candidate) => candidate.id !== visual.chosenImageId,
          ),
        })),
      exportedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`;
}

export async function renderProjectVideo(project: Project): Promise<Project> {
  let current = await saveProject({
    ...project,
    status: "rendering",
    statusMessage: "Rendering 1080p video with FFmpeg",
    error: undefined,
  });
  try {
    const renderDir = projectRenderDir(project.id);
    await mkdir(renderDir, { recursive: true });
    const output = path.join(renderDir, "k-versation-export.mp4");
    const active = project.visuals
      .filter((visual) => !visual.removed && visual.chosenImageId)
      .sort((a, b) => a.startTime - b.startTime);
    const images: Array<{
      path: string;
      start: number;
      duration: number;
    }> = [];
    for (const [index, visual] of active.entries()) {
      const candidate = chosenImage(project, visual.chosenImageId);
      if (!candidate) continue;
      images.push({
        path: await cacheImage(project.id, candidate, index),
        start: visual.startTime,
        duration: Math.max(0.5, visual.endTime - visual.startTime),
      });
    }

    const args = [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=0x101014:s=1920x1080:r=30:d=${project.duration.toFixed(3)}`,
      "-i",
      resolveDataPath(project.mediaPath),
    ];
    for (const image of images) {
      args.push("-loop", "1", "-t", image.duration.toFixed(3), "-i", image.path);
    }

    const filters = ["[0:v]format=yuv420p[base0]"];
    images.forEach((image, index) => {
      const inputIndex = index + 2;
      const fadeOut = Math.max(0, image.duration - 0.35);
      filters.push(
        `[${inputIndex}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x101014,format=rgba,fade=t=in:st=0:d=0.35:alpha=1,fade=t=out:st=${fadeOut.toFixed(3)}:d=0.35:alpha=1,setpts=PTS-STARTPTS+${image.start.toFixed(3)}/TB[image${index}]`,
      );
      filters.push(
        `[base${index}][image${index}]overlay=eof_action=pass:shortest=0[base${index + 1}]`,
      );
    });
    const finalVideo = images.length ? `[base${images.length}]` : "[base0]";
    args.push(
      "-filter_complex",
      filters.join(";"),
      "-map",
      finalVideo,
      "-map",
      "1:a:0",
      "-t",
      project.duration.toFixed(3),
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      output,
    );
    await runFfmpeg(args);

    await Promise.all([
      writeFile(path.join(renderDir, "transcript.txt"), transcriptText(project)),
      writeFile(path.join(renderDir, "subtitles.srt"), srtText(project)),
      writeFile(path.join(renderDir, "timeline.json"), timelineJson(project)),
    ]);
    current = await saveProject({
      ...current,
      outputVideoPath: toDataRelativePath(output),
      status: "complete",
      statusMessage: "Export complete",
    });
    return current;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rendering failed";
    return saveProject({
      ...current,
      status: "error",
      statusMessage: message,
      error: message,
    });
  }
}

export async function readRenderedFile(
  project: Project,
  fileName: string,
): Promise<Buffer> {
  return readFile(path.join(projectRenderDir(project.id), fileName));
}
