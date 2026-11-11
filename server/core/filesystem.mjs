import { constants } from "node:fs";
import { open, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

function requireAbsolutePath(input, label) {
  if (typeof input !== "string" || input.trim().length === 0 || !path.isAbsolute(input)) {
    throw new TypeError(`${label} must be an absolute local path.`);
  }
  return input;
}

export async function resolveDirectory(input) {
  const canonical = await realpath(requireAbsolutePath(input, "Directory"));
  const details = await stat(canonical);
  if (!details.isDirectory()) throw new TypeError("The requested path is not a directory.");
  return canonical;
}

export async function resolveTextFile(input, { maxBytes = 262_144 } = {}) {
  const canonical = await realpath(requireAbsolutePath(input, "File path"));
  const details = await stat(canonical);
  if (!details.isFile()) throw new TypeError("The requested path is not a regular file.");
  if (details.size > maxBytes) throw new RangeError(`File exceeds the ${maxBytes}-byte read limit.`);
  return canonical;
}

export async function listDirectory(input, { maxEntries = 100 } = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 200) {
    throw new RangeError("maxEntries must be between 1 and 200.");
  }
  const directory = await resolveDirectory(input);
  const entries = await readdir(directory, { withFileTypes: true });
  const sorted = entries.sort((a, b) => a.name.localeCompare(b.name));
  return {
    path: directory,
    totalEntries: entries.length,
    returnedEntries: Math.min(sorted.length, maxEntries),
    truncated: sorted.length > maxEntries,
    entries: sorted.slice(0, maxEntries).map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : entry.isSymbolicLink() ? "symlink" : "other",
    })),
  };
}

export async function readTextFile(input, { maxBytes = 262_144 } = {}) {
  const filePath = await resolveTextFile(input, { maxBytes });
  const handle = await open(filePath, constants.O_RDONLY);
  try {
    const opened = await handle.stat();
    const currentPath = await realpath(filePath);
    if (currentPath !== filePath || !opened.isFile() || opened.size > maxBytes) {
      throw new Error("File changed during validation; retry the read.");
    }
    const buffer = await handle.readFile();
    if (buffer.length > maxBytes) throw new RangeError(`File exceeds the ${maxBytes}-byte read limit.`);
    if (buffer.includes(0)) throw new TypeError("Binary files are not supported by files_read.");
    let content;
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
    catch { throw new TypeError("The requested file is not valid UTF-8 text."); }
    return { path: filePath, bytes: buffer.length, content };
  } finally {
    await handle.close();
  }
}
