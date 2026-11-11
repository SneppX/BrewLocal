function normalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON rejects non-finite numbers.");
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Canonical JSON accepts plain objects only.");
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) throw new TypeError("Canonical JSON rejects undefined values.");
      output[key] = normalize(value[key]);
    }
    return output;
  }
  throw new TypeError("Value is not JSON serializable.");
}

export function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}
