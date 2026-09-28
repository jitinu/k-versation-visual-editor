import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config";
import { createLogger } from "../logger";
import { resolveInProject } from "../storage/files";
import type { Project, RenderSettings } from "../types";
import { activeEntries, chosenImage } from "./timeline";
import { transcriptToSrt } from "./srt";

const log = createLogger("render");

export interface RenderPlan {
  args: string[];
  outputRel: string;
  durationSeconds: number;
}

const FPS = 30;

/**
 * Build the ffmpeg invocation: black base canvas, each chosen image overlaid at
 * its timestamps with fade in/out (optional Ken Burns), original narration audio.
 */
export async function buildRenderPlan(project: Project, settings: RenderSettings): Promise<RenderPlan> {
  if (!project.mediaPath) throw new Error("Project has no media");
  const transcript = project.alignedTranscript ?? project.transcript;
  const duration = project.mediaDuration || transcript?.duration || 0;
  if (!duration) throw new Error("Unknown media duration");

  const { width: W, height: H, fadeDuration: F } = settings;
  const media = resolveInProject(project.id, project.mediaPath);
  const entries = activeEntries(project.timeline).sort((a, b) => a.start - b.start);

  const args: string[] = ["-y", "-hide_banner", "-loglevel", "error", "-progress", "pipe:1", "-i", media];
  const filters: string[] = [`color=c=black:s=${W}x${H}:r=${FPS}:d=${duration.toFixed(3)}[bg]`];

  entries.forEach((e, i) => {
    const img = resolveInProject(project.id, chosenImage(e)!.localPath!);
    const hold = Math.max(1, e.end - e.start);
    args.push("-loop", "1", "-framerate", String(FPS), "-t", hold.toFixed(3), "-i", img);
    const inIdx = i + 1;
    const fade = Math.min(F, hold / 2);
    const chain = [
      `[${inIdx}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos`,
      `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`,
      `setsar=1`,
    ];
    if (settings.kenBurns || e.kenBurns) {
      const frames = Math.round(hold * FPS);
      chain.push(
        `zoompan=z='min(zoom+0.0006,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS}`,
      );
    }
    chain.push(`fade=t=in:st=0:d=${fade.toFixed(2)}`);
    chain.push(`fade=t=out:st=${(hold - fade).toFixed(2)}:d=${fade.toFixed(2)}`);
    chain.push(`setpts=PTS-STARTPTS+${e.start.toFixed(3)}/TB[img${i}]`);
    filters.push(chain.join(","));
  });

  let last = "bg";
  entries.forEach((e, i) => {
    const out = i === entries.length - 1 ? "vout" : `v${i}`;
    filters.push(
      `[${last}][img${i}]overlay=0:0:eof_action=pass:enable='between(t,${e.start.toFixed(3)},${e.end.toFixed(3)})'[${out}]`,
    );
    last = out;
  });
  if (entries.length === 0) {
    filters.push(`[bg]null[vout]`);
  }

  let videoLabel = "vout";
  if (settings.burnSubtitles && transcript) {
    const srtRel = path.join("renders", "subtitles.srt");
    await fs.writeFile(resolveInProject(project.id, srtRel), transcriptToSrt(transcript));
    const srtPath = resolveInProject(project.id, srtRel).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
    filters.push(`[vout]subtitles='${srtPath}':force_style='FontSize=20,Outline=1,MarginV=40'[vsub]`);
    videoLabel = "vsub";
  }

  const outputRel = path.join("renders", `render-${Date.now()}.mp4`);
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    `[${videoLabel}]`,
    "-map",
    "0:a:0",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(FPS),
    "-c:a",
    "aac",
    "-b:a",
    "256k",
    "-movflags",
    "+faststart",
    "-t",
    duration.toFixed(3),
    resolveInProject(project.id, outputRel),
  );
  return { args, outputRel, durationSeconds: duration };
}

export function runFfmpeg(plan: RenderPlan, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    log.info("ffmpeg start", { output: plan.outputRel, inputs: (plan.args.length - 20) / 8 });
    const proc = spawn(config.render.ffmpegPath, plan.args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) {
        const m = /^out_time_ms=(\d+)/.exec(line.trim());
        if (m) onProgress(Math.min(0.99, Number(m[1]) / 1e6 / plan.durationSeconds));
      }
    });
    proc.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim().split("\n").slice(-5).join(" | ")}`));
    });
  });
}
