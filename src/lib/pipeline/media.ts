import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config";

const execFileP = promisify(execFile);

export async function probeDuration(absPath: string): Promise<number> {
  try {
    const { stdout } = await execFileP(config.render.ffprobePath, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      absPath,
    ]);
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) ? d : 0;
  } catch {
    return 0;
  }
}

/** Extract mono 16k mp3 for uploading to a transcription API (smaller than raw video). */
export async function extractAudio(absInput: string, absOutput: string): Promise<void> {
  await execFileP(config.render.ffmpegPath, [
    "-y",
    "-i",
    absInput,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-b:a",
    "64k",
    absOutput,
  ]);
}
