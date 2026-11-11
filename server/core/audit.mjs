const SECRET_KEY = /password|token|secret|cookie|authorization|credential|private.?key|api.?key/i;

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
      resource: String(event.resource ?? "*").slice(0, 512),
      metadata: redact(event.metadata ?? {}),
    });
    this.#events.push(safe);
    if (this.#events.length > this.#maxEvents) this.#events.splice(0, this.#events.length - this.#maxEvents);
    return safe;
  }
  list(limit = 100) { return this.#events.slice(-Math.max(0, Math.min(500, limit))); }
}
