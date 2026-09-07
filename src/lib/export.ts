import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { config } from "@/lib/config";
import {
  projectCacheDir,
  projectRenderDir,
  resolveDataPath,
  toDataRelativePath,
  updateProject,
} from "@/lib/storage";
import type { ImageCandidate, Project } from "@/lib/types";
import { createId, formatSrtTimestamp, retry } from "@/lib/utils";

const maxImageBytes = 25 * 1024 * 1024;
const trustedImageHosts = new Set([
  "thumb.wikimedia.org",
  "upload.wikimedia.org",
]);

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

export function trustedImageUrl(value: string, base?: URL): URL {
  const url = base ? new URL(value, base) : new URL(value);
  if (url.protocol !== "https:" || !trustedImageHosts.has(url.hostname)) {
    throw new Error("Selected image URL is not from an approved provider");
  }
  return url;
}

async function fetchTrustedImage(value: string): Promise<Response> {
  let url = trustedImageUrl(value);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Visual-Story-Maker/1.0 (personal visual editor)",
        Accept: "image/*",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status < 300 || response.status >= 400) {
      return response;
    }
    const location = response.headers.get("location");
    if (!location) {
      throw new Error("Image provider returned an invalid redirect");
    }
    url = trustedImageUrl(location, url);
  }
  throw new Error("Image provider returned too many redirects");
}

async function readLimitedImage(response: Response): Promise<Buffer> {
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > maxImageBytes) {
    throw new Error("Selected image is too large");
  }
  if (!response.body) {
    throw new Error("Selected image returned no content");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxImageBytes) {
        await reader.cancel();
        throw new Error("Selected image is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function cacheImage(
  projectId: string,
  candidate: ImageCandidate,
  index: number,
): Promise<string> {
  if (candidate.localPath) {
    return resolveDataPath(candidate.localPath);
  }
  const directory = projectCacheDir(projectId);
  await mkdir(directory, { recursive: true });
  const destination = path.join(directory, `visual-${index}.jpg`);
  const urls = [candidate.thumbnailUrl, candidate.imageUrl]
    .filter(
      (url, urlIndex, candidates) =>
        Boolean(url) && candidates.indexOf(url) === urlIndex,
    )
    .map((url) => trustedImageUrl(url).toString());
  let response: Response | undefined;
  let lastError: unknown;
  for (const imageUrl of urls) {
    try {
      response = await retry(
        async () => {
          const result = await fetchTrustedImage(imageUrl);
          if (!result.ok) {
            throw new Error(
              `Could not download selected image (${result.status})`,
            );
          }
          return result;
        },
        4,
        1_000,
      );
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!response) {
    throw lastError ?? new Error("Could not download selected image");
  }
  const bytes = await readLimitedImage(response);
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

export async function renderProjectVideo(projectId: string): Promise<Project> {
  let current = await updateProject(projectId, (project) => ({
    ...project,
    outputVideoPath: undefined,
    status: "rendering",
    statusMessage: "Rendering 1080p video with FFmpeg",
    error: undefined,
  }));
  let temporaryOutput: string | undefined;
  try {
    const renderDir = projectRenderDir(projectId);
    await mkdir(renderDir, { recursive: true });
    const output = path.join(renderDir, "k-versation-export.mp4");
    temporaryOutput = path.join(renderDir, `${createId("render")}.mp4`);
    const active = current.visuals
      .filter((visual) => !visual.removed && visual.chosenImageId)
      .sort((a, b) => a.startTime - b.startTime);
    const images: Array<{
      path: string;
      start: number;
      duration: number;
    }> = [];
    for (const [index, visual] of active.entries()) {
      const candidate = chosenImage(current, visual.chosenImageId);
      if (!candidate) continue;
      images.push({
        path: await cacheImage(projectId, candidate, index),
        start: visual.startTime,
        duration: Math.max(0.5, visual.endTime - visual.startTime),
      });
    }

    const args = [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=0x101014:s=1920x1080:r=30:d=${current.duration.toFixed(3)}`,
      "-i",
      resolveDataPath(current.mediaPath),
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
      current.duration.toFixed(3),
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
      temporaryOutput,
    );
    await runFfmpeg(args);
    await rename(temporaryOutput, output);
    temporaryOutput = undefined;

    await Promise.all([
      writeFile(path.join(renderDir, "transcript.txt"), transcriptText(current)),
      writeFile(path.join(renderDir, "subtitles.srt"), srtText(current)),
      writeFile(path.join(renderDir, "timeline.json"), timelineJson(current)),
    ]);
    current = await updateProject(projectId, (latest) =>
      latest.status === "rendering"
        ? {
            ...latest,
            outputVideoPath: toDataRelativePath(output),
            status: "complete",
            statusMessage: "Export complete",
          }
        : latest,
    );
    return current;
  } catch (error) {
    if (temporaryOutput) {
      await rm(temporaryOutput, { force: true }).catch(() => undefined);
    }
    const message = error instanceof Error ? error.message : "Rendering failed";
    return updateProject(projectId, (latest) =>
      latest.status === "rendering"
        ? {
            ...latest,
            outputVideoPath: undefined,
            status: "error",
            statusMessage: message,
            error: message,
          }
        : latest,
    );
  }
}

export async function readRenderedFile(
  project: Project,
  fileName: string,
): Promise<Buffer> {
  return readFile(path.join(projectRenderDir(project.id), fileName));
}
