import { createHash } from "node:crypto";\n\nconst SECRET_KEY = /password|token|secret|cookie|authorization|credential|private.?key|api.?key/i;\n\nfunction safeResource(value) {\n  const resource = String(value ?? "*").slice(0, 4096);\n  if (/^(?:[A-Za-z]:[\\\\/]|\\\\\\\\|\\/)/.test(resource)) {\n    return `[LOCAL_PATH:${createHash("sha256").update(resource).digest("hex").slice(0, 12)}]`;\n  }\n  return resource.slice(0, 512);\n}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, SECRET_KEY.test(key) ? "[REDACTED]" : redact(child)]));
}

export class AuditLog {
  #events = [];
  #maxEvents;
  constructor(maxEvents = 500) { this.#maxEvents = maxEvents; }
  record(event) {
    const safe = Object.freeze({
      timestamp: new Date().toISOString(),
      action: String(event.action ?? "unknown").slice(0, 128),
      capability: String(event.capability ?? "unknown").slice(0, 128),
      operation: String(event.operation ?? "unknown").slice(0, 128),
      decision: String(event.decision ?? "unknown").slice(0, 32),
      resource: safeResource(event.resource),
      metadata: redact(event.metadata ?? {}),
    });
    this.#events.push(safe);
    if (this.#events.length > this.#maxEvents) this.#events.splice(0, this.#events.length - this.#maxEvents);
    return safe;
  }
  list(limit = 100) { return this.#events.slice(-Math.max(0, Math.min(500, limit))); }
}
