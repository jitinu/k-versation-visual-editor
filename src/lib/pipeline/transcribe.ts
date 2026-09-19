import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config";
import { createLogger } from "../logger";
import { transcribeAudio } from "../llm/openai";
import type { Transcript, TranscriptSegment, TranscriptWord } from "../types";
import { tokenizeWords } from "../util";
import { extractAudio, probeDuration } from "./media";

const log = createLogger("transcribe");

/** Group words into ~12 word / sentence-ish segments. */
export function segmentWords(words: TranscriptWord[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let buf: TranscriptWord[] = [];
  const flush = () => {
    if (!buf.length) return;
    segments.push({
      id: `seg_${segments.length}`,
      start: buf[0].start,
      end: buf[buf.length - 1].end,
      text: buf.map((w) => w.word).join(" "),
    });
    buf = [];
  };
  for (const w of words) {
    buf.push(w);
    const endsSentence = /[.!?]$/.test(w.word);
    if ((endsSentence && buf.length >= 6) || buf.length >= 18) flush();
  }
  flush();
  return segments;
}

async function transcribeWithOpenAI(absMedia: string, tmpDir: string): Promise<Transcript> {
  const audioPath = path.join(tmpDir, "audio-16k.mp3");
  await extractAudio(absMedia, audioPath);
  const buf = await fs.readFile(audioPath);
  const result = await transcribeAudio(new Blob([buf], { type: "audio/mpeg" }), "audio.mp3");
  const words: TranscriptWord[] = (result.words ?? []).map((w) => ({
    word: w.word,
    start: w.start,
    end: w.end,
  }));
  const segments: TranscriptSegment[] =
    result.segments?.map((s, i) => ({ id: `seg_${i}`, start: s.start, end: s.end, text: s.text.trim() })) ??
    segmentWords(words);
  return {
    text: result.text,
    language: result.language,
    duration: result.duration ?? (words.at(-1)?.end ?? 0),
    words,
    segments,
    provider: "openai",
  };
}

/**
 * LOCAL provider (free, offline): runs `scripts/local_whisper.py` (faster-whisper) with
 * word timestamps. The script is deliberately NOT passed as `initial_prompt`: Whisper tends to
 * hallucinate/loop when primed with long text, which corrupts the timing anchors that
 * `alignScript` relies on. Wording is fixed downstream by the alignment step instead.
 */
async function transcribeLocal(absMedia: string, tmpDir: string): Promise<Transcript> {
  const audioPath = path.join(tmpDir, "audio-16k.mp3");
  await extractAudio(absMedia, audioPath);
  const { localModel, localDevice, localComputeType, pythonPath } = config.transcription;
  const args = [
    path.join(process.cwd(), "scripts", "local_whisper.py"),
    audioPath,
    "--model",
    localModel,
    "--device",
    localDevice,
    "--compute-type",
    localComputeType,
  ];
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(pythonPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`local whisper exited ${code}: ${err.trim().split("\n").slice(-3).join(" | ")}`));
    });
  });
  const json = JSON.parse(stdout) as {
    text: string;
    language?: string;
    duration?: number;
    words: TranscriptWord[];
    segments: Array<{ start: number; end: number; text: string }>;
  };
  const words = json.words.filter((w) => w.word && w.end > w.start);
  return {
    text: json.text,
    language: json.language,
    duration: json.duration ?? (words.at(-1)?.end ?? 0),
    words,
    segments: json.segments.length
      ? json.segments.map((s, i) => ({ id: `seg_${i}`, ...s }))
      : segmentWords(words),
    provider: "local",
  };
}

/**
 * WhisperX adapter: expects a self-hosted HTTP service (WHISPERX_URL) that accepts
 * multipart `file` and returns `{ text, language, word_segments: [{word,start,end}] }`
 * (the default whisperx JSON output shape).
 */
async function transcribeWithWhisperX(absMedia: string): Promise<Transcript> {
  if (!config.transcription.whisperxUrl) throw new Error("WHISPERX_URL is not configured");
  const buf = await fs.readFile(absMedia);
  const form = new FormData();
  form.append("file", new Blob([buf]), path.basename(absMedia));
  const res = await fetch(config.transcription.whisperxUrl, { method: "POST", body: form });
  if (!res.ok) throw new Error(`WhisperX failed: ${res.status}`);
  const json = (await res.json()) as {
    text?: string;
    language?: string;
    word_segments: Array<{ word: string; start: number; end: number }>;
  };
  const words = json.word_segments.map((w) => ({ word: w.word, start: w.start, end: w.end }));
  return {
    text: json.text ?? words.map((w) => w.word).join(" "),
    language: json.language,
    duration: words.at(-1)?.end ?? 0,
    words,
    segments: segmentWords(words),
    provider: "whisperx",
  };
}

/**
 * MOCK transcription (no API key). Produces evenly-spaced word timestamps
 * from the supplied script, or a placeholder narration if no script is present.
 * Clearly marked via `provider: "mock"`.
 */
export function mockTranscript(duration: number, script?: string): Transcript {
  const text =
    script?.trim() ||
    "This is a placeholder transcript generated in mock mode because no transcription provider is configured. " +
      "In eighteen fifteen, Napoleon Bonaparte faced the allied armies at Waterloo in present-day Belgium. " +
      "The Duke of Wellington held the ridge at Mont-Saint-Jean while Prussian forces under Blücher marched to his aid. " +
      "By nightfall the French army was broken and Napoleon's final campaign was over. " +
      "Install faster-whisper (pip install faster-whisper) or set OPENAI_API_KEY to enable real transcription.";
  const tokens = tokenizeWords(text);
  const total = duration > 0 ? duration : Math.max(10, tokens.length * 0.4);
  const per = total / Math.max(tokens.length, 1);
  const words: TranscriptWord[] = tokens.map((t, i) => ({
    word: t,
    start: +(i * per).toFixed(3),
    end: +((i + 1) * per - 0.05).toFixed(3),
  }));
  return { text, duration: total, words, segments: segmentWords(words), provider: "mock" };
}

export async function transcribe(absMedia: string, tmpDir: string, script?: string): Promise<Transcript> {
  const provider = config.transcription.provider;
  log.info(`transcribing with provider=${provider}`);
  const duration = await probeDuration(absMedia);
  try {
    if (provider === "local") {
      const t = await transcribeLocal(absMedia, tmpDir);
      if (!t.duration) t.duration = duration;
      return t;
    }
    if (provider === "openai") {
      const t = await transcribeWithOpenAI(absMedia, tmpDir);
      if (!t.duration) t.duration = duration;
      return t;
    }
    if (provider === "whisperx") {
      const t = await transcribeWithWhisperX(absMedia);
      if (!t.duration) t.duration = duration;
      return t;
    }
  } catch (err) {
    log.error("transcription provider failed, falling back to mock", err);
  }
  return mockTranscript(duration, script);
}
