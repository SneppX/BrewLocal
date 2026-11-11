import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { validatePolicy } from "./permissions.mjs";

const DEFAULT_POLICIES = [
  { capability: "browser", operation: "*", resource: "*", mode: "ask" },
  { capability: "system", operation: "info", resource: "system", mode: "ask" },
];

export class PolicyStore {
  #directory;
  #file;
  #writeQueue = Promise.resolve();

  constructor(directory = path.join(os.homedir(), ".brewpilot", "config")) {
    this.#directory = directory;
    this.#file = path.join(directory, "permissions.json");
  }

  async load() {
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    try {
      const parsed = JSON.parse(await readFile(this.#file, "utf8"));
      if (parsed.version !== 1 || !Array.isArray(parsed.policies)) throw new Error("Unsupported permissions file format.");
      return parsed.policies.map(validatePolicy);
    } catch (error) {
      if (error?.code === "ENOENT") {
        const initial = DEFAULT_POLICIES.map((policy) => ({ ...policy }));
        await this.save(initial);
        return initial;
      }
      // Fail closed if the local policy file is malformed or contains invalid policies.
      process.stderr.write(`[BrewPilot] Permission file could not be loaded; using deny-by-default. ${error.message}\n`);
      return [];
    }
  }

  async save(policies) {
    const normalized = policies.map(validatePolicy);
    const task = async () => {
      await mkdir(this.#directory, { recursive: true, mode: 0o700 });
      const temporary = path.join(this.#directory, `.permissions-${randomUUID()}.tmp`);
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify({ version: 1, policies: normalized }, null, 2)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      try { await rename(temporary, this.#file); }
      catch (error) { await rm(temporary, { force: true }); throw error; }
    };
    this.#writeQueue = this.#writeQueue.then(task, task);
    return this.#writeQueue;
  }
}
