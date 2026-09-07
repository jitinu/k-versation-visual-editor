import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "@/lib/config";
import type { TranscriptSegment } from "@/lib/types";
import { clamp, createId, retry } from "@/lib/utils";

interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}

interface WhisperResponse {
  text?: string;
  duration?: number;
  segments?: WhisperSegment[];
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    process.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    process.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    process.on("error", reject);
    process.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
      }
    });
  });
}

export async function getMediaDuration(mediaPath: string): Promise<number> {
  const output = await run(config.ffprobePath, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    mediaPath,
  ]);
  const duration = Number(output.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Could not determine media duration");
  }
  return duration;
}

function splitSentences(text: string): string[] {
  return text
    .replaceAll(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function distributeText(text: string, duration: number): TranscriptSegment[] {
  const sentences = splitSentences(text);
  if (sentences.length === 0) {
    return [];
  }
  const totalWords = sentences.reduce(
    (total, sentence) => total + sentence.split(/\s+/).length,
    0,
  );
  let elapsed = 0;
  return sentences.map((sentence, index) => {
    const words = sentence.split(/\s+/).length;
    const start = elapsed;
    elapsed =
      index === sentences.length - 1
        ? duration
        : clamp(elapsed + (words / totalWords) * duration, start + 0.5, duration);
    return {
      id: createId("segment"),
      start,
      end: elapsed,
      text: sentence,
    };
  });
}

export function interpolateTime(
  _transcript: TranscriptSegment[],
  fraction: number,
  duration: number,
): number {
  return clamp(fraction * duration, 0, duration);
}

function alignScript(
  script: string,
  transcript: TranscriptSegment[],
  duration: number,
): TranscriptSegment[] {
  const sentences = splitSentences(script);
  const totalWords = sentences.reduce(
    (total, sentence) => total + sentence.split(/\s+/).length,
    0,
  );
  if (sentences.length === 0 || totalWords === 0) {
    return transcript;
  }
  let consumedWords = 0;
  return sentences.map((sentence, index) => {
    const startFraction = consumedWords / totalWords;
    consumedWords += sentence.split(/\s+/).length;
    const endFraction = consumedWords / totalWords;
    return {
      id: createId("segment"),
      start: interpolateTime(transcript, startFraction, duration),
      end:
        index === sentences.length - 1
          ? duration
          : interpolateTime(transcript, endFraction, duration),
      text: sentence,
    };
  });
}

async function transcribeWithOpenAi(mediaPath: string): Promise<WhisperResponse> {
  if (!config.openAiApiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  const media = await readFile(mediaPath);
  const form = new FormData();
  form.append("file", new Blob([media]), path.basename(mediaPath));
  form.append("model", config.transcriptionModel);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");

  const response = await fetch(`${config.openAiBaseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.openAiApiKey}` },
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) {
    throw new Error(`Transcription failed (${response.status})`);
  }
  return (await response.json()) as WhisperResponse;
}

export async function createTranscript(
  mediaPath: string,
  duration: number,
  script?: string,
): Promise<{
  segments: TranscriptSegment[];
  source: "openai" | "script-alignment" | "demo";
}> {
  if (config.openAiApiKey) {
    const result = await retry(() => transcribeWithOpenAi(mediaPath), 2, 1000);
    const rawSegments =
      result.segments?.map((segment) => ({
        id: createId("segment"),
        start: segment.start,
        end: segment.end,
        text: segment.text.trim(),
      })) ?? distributeText(result.text ?? "", duration);
    return {
      segments: script
        ? alignScript(script, rawSegments, duration)
        : rawSegments,
      source: script ? "script-alignment" : "openai",
    };
  }

  if (script?.trim()) {
    return {
      segments: distributeText(script, duration),
      source: "script-alignment",
    };
  }

  const label = path
    .basename(mediaPath, path.extname(mediaPath))
    .replaceAll(/[-_]+/g, " ");
  return {
    segments: distributeText(
      `Demo transcript for ${label}. Configure an OpenAI API key to transcribe the spoken audio with precise timestamps. The full generation and export workflow remains available in this local fallback mode.`,
      duration,
    ),
    source: "demo",
  };
}
