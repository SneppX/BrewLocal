import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { lstat, open, readdir, realpath, stat, unlink, rename } from "node:fs/promises";
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


export async function resolveWritableTarget(input) {
  const requested = requireAbsolutePath(input, "File path");
  const parent = await realpath(path.dirname(requested));
  const name = path.basename(requested);
  if (!name || name === "." || name === "..") throw new TypeError("A file name is required.");
  const target = path.join(parent, name);
  try {
    const details = await lstat(target);
    if (details.isSymbolicLink()) throw new TypeError("Symbolic links are not supported for file writes.");
    if (!details.isFile()) throw new TypeError("The requested path is not a regular file.");
    return { path: target, exists: true };
  } catch (error) {
    if (error?.code === "ENOENT") return { path: target, exists: false };
    throw error;
  }
}

export async function writeTextFile(input, content, { overwrite = false, maxBytes = 262_144 } = {}) {
  if (typeof content !== "string") throw new TypeError("File content must be a UTF-8 string.");
  if (content.includes("\0")) throw new TypeError("NUL bytes are not supported in text files.");
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 262_144) {
    throw new RangeError("maxBytes must be between 1 and 262144.");
  }
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > maxBytes) throw new RangeError(`Content exceeds the ${maxBytes}-byte write limit.`);
  const target = await resolveWritableTarget(input);
  if (target.exists && !overwrite) throw new Error("The target file already exists. Set overwrite=true only after explicit approval.");

  if (!target.exists) {
    const handle = await open(target.path, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    return { path: target.path, bytes, created: true, overwritten: false };
  }

  const temporary = path.join(path.dirname(target.path), `.brewpilot-${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
  await handle.close();
  try {
    await rename(temporary, target.path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return { path: target.path, bytes, created: false, overwritten: true };
}

export async function deleteFile(input) {
  const target = await resolveWritableTarget(input);
  if (!target.exists) throw new Error("The requested file does not exist.");
  await unlink(target.path);
  return { path: target.path, deleted: true };
}
