export function mediaQueryFromFilename(filename: string): string {
  const basename = filename.split(/[\\/]/).pop() ?? filename;
  const query = basename.replace(/\.[^.]+$/, "").replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
  let cleaned = query;
  while (cleaned) {
    const next = cleaned.replace(/\s+(?:\(\d+\)|final|v\d+|copy|\d+)$/i, "").trim();
    if (next === cleaned) break;
    cleaned = next;
  }
  return cleaned;
}
