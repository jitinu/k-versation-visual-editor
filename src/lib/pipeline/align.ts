import type { Transcript, TranscriptWord } from "../types";
import { normalizeWord } from "../util";
import { segmentWords } from "./transcribe";

/**
 * Align a user-supplied script to the real audio using the WORD-LEVEL timestamps
 * of the ASR transcript. Standard Needleman–Wunsch style global alignment over
 * normalised tokens; script words that match an ASR word inherit its timestamps,
 * unmatched script words are interpolated between neighbouring anchors.
 *
 * The result keeps the script's exact wording (the "truth") but every word has a
 * timestamp taken from the audio, which is what the moment-selection and render
 * steps consume.
 */
export function alignScriptToTranscript(script: string, asr: Transcript): Transcript {
  const scriptTokens = script.split(/\s+/).filter((t) => normalizeWord(t).length > 0);
  const asrWords = asr.words.filter((w) => normalizeWord(w.word).length > 0);
  if (!scriptTokens.length || !asrWords.length) return { ...asr, alignedFromScript: false };

  const a = scriptTokens.map(normalizeWord);
  const b = asrWords.map((w) => normalizeWord(w.word));
  const n = a.length;
  const m = b.length;

  // banded DP to keep memory sane on long narrations
  const band = Math.max(60, Math.ceil(Math.abs(n - m) * 1.5) + 40);
  const MATCH = 2;
  const MISMATCH = -1;
  const GAP = -1;
  const NEG = -1e9;

  const score: Int32Array[] = [];
  const trace: Uint8Array[] = []; // 0 diag, 1 up (skip script word), 2 left (skip asr word)
  for (let i = 0; i <= n; i++) {
    score.push(new Int32Array(m + 1).fill(NEG));
    trace.push(new Uint8Array(m + 1));
  }
  score[0][0] = 0;
  for (let i = 1; i <= n; i++) {
    score[i][0] = i * GAP;
    trace[i][0] = 1;
  }
  for (let j = 1; j <= m; j++) {
    score[0][j] = j * GAP;
    trace[0][j] = 2;
  }
  for (let i = 1; i <= n; i++) {
    const center = Math.round((i / n) * m);
    const jStart = Math.max(1, center - band);
    const jEnd = Math.min(m, center + band);
    for (let j = jStart; j <= jEnd; j++) {
      const sim = a[i - 1] === b[j - 1] ? MATCH : fuzzyMatch(a[i - 1], b[j - 1]) ? 1 : MISMATCH;
      const diag = score[i - 1][j - 1] + sim;
      const up = score[i - 1][j] + GAP;
      const left = score[i][j - 1] + GAP;
      let best = diag;
      let t = 0;
      if (up > best) {
        best = up;
        t = 1;
      }
      if (left > best) {
        best = left;
        t = 2;
      }
      score[i][j] = best;
      trace[i][j] = t;
    }
  }

  // backtrack
  const mapping: Array<number | null> = new Array(n).fill(null);
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const t = i === 0 ? 2 : j === 0 ? 1 : trace[i][j];
    if (t === 0) {
      if (a[i - 1] === b[j - 1] || fuzzyMatch(a[i - 1], b[j - 1])) mapping[i - 1] = j - 1;
      i--;
      j--;
    } else if (t === 1) i--;
    else j--;
  }

  // assign timestamps; interpolate unmatched words between anchors
  const words: TranscriptWord[] = new Array(n);
  let k = 0;
  while (k < n) {
    if (mapping[k] !== null) {
      const w = asrWords[mapping[k] as number];
      words[k] = { word: scriptTokens[k], start: w.start, end: w.end };
      k++;
      continue;
    }
    let runEnd = k;
    while (runEnd < n && mapping[runEnd] === null) runEnd++;
    const prevEnd = k > 0 ? words[k - 1].end : 0;
    const nextStart =
      runEnd < n ? asrWords[mapping[runEnd] as number].start : Math.max(prevEnd + 0.3 * (runEnd - k), asr.duration);
    const span = Math.max(nextStart - prevEnd, 0.05 * (runEnd - k));
    const per = span / (runEnd - k);
    for (let q = k; q < runEnd; q++) {
      const s = prevEnd + (q - k) * per;
      words[q] = { word: scriptTokens[q], start: +s.toFixed(3), end: +(s + per * 0.9).toFixed(3) };
    }
    k = runEnd;
  }

  return {
    text: scriptTokens.join(" "),
    language: asr.language,
    duration: asr.duration,
    words,
    segments: segmentWords(words),
    provider: `${asr.provider}+script-align`,
    alignedFromScript: true,
  };
}

function fuzzyMatch(x: string, y: string): boolean {
  if (x.length < 4 || y.length < 4) return false;
  if (x.startsWith(y) || y.startsWith(x)) return true;
  return levenshtein(x, y) <= Math.floor(Math.max(x.length, y.length) / 4);
}

function levenshtein(x: string, y: string): number {
  const prev = new Array(y.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    let last = i;
    let diagPrev = prev[0];
    prev[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const tmp = prev[j];
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      last = Math.min(prev[j] + 1, last + 1, diagPrev + cost);
      diagPrev = tmp;
      prev[j] = last;
    }
  }
  return prev[y.length];
}
