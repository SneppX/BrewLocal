import { createHash, verify } from "node:crypto";
import { canonicalJson } from "../core/canonical-json.mjs";

const RISK_LEVELS = new Set(["read", "write", "external", "destructive", "privileged"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validEnvelope(input) {
  if (!isRecord(input) || input.protocolVersion !== 1) return false;
  const allowedKeys = ["protocolVersion", "requestId", "deviceId", "issuedAt", "expiresAt", "nonce", "capability", "operation", "resource", "risk", "args", "argsDigest", "signature"];
  if (Object.keys(input).some((key) => !allowedKeys.includes(key)) || Object.keys(input).length !== allowedKeys.length) return false;
  if (typeof input.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) return false;
  if (typeof input.deviceId !== "string" || input.deviceId.length < 8 || input.deviceId.length > 128) return false;
  if (!Number.isSafeInteger(input.issuedAt) || !Number.isSafeInteger(input.expiresAt)) return false;
  if (typeof input.nonce !== "string" || input.nonce.length < 22 || input.nonce.length > 128) return false;
  for (const field of ["capability", "operation", "resource"]) {
    if (typeof input[field] !== "string" || !input[field].trim() || input[field].length > 1024) return false;
  }
  if (!RISK_LEVELS.has(input.risk) || !isRecord(input.args)) return false;
  if (typeof input.argsDigest !== "string" || !/^[a-f0-9]{64}$/.test(input.argsDigest)) return false;
  if (typeof input.signature !== "string" || input.signature.length < 40 || input.signature.length > 256) return false;
  return true;
}

export function sha256Canonical(value) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export async function verifySignedRequest(input, servicePublicKey, options) {
  if (!validEnvelope(input)) return { ok: false, reason: "invalid_envelope" };
  if (!options?.nonceStore || typeof options.nonceStore.claim !== "function") throw new TypeError("A nonce store is required.");
  const now = options.now ?? Date.now();
  const maxLifetime = options.maxLifetimeMs ?? 60_000;
  const maxSkew = options.maxClockSkewMs ?? 30_000;
  if (input.issuedAt > now + maxSkew || input.issuedAt < now - maxSkew) return { ok: false, reason: "clock_skew" };
  if (input.expiresAt <= now) return { ok: false, reason: "expired" };
  if (input.expiresAt <= input.issuedAt || input.expiresAt - input.issuedAt > maxLifetime) return { ok: false, reason: "lifetime_exceeded" };
  if (sha256Canonical(input.args) !== input.argsDigest) return { ok: false, reason: "digest_mismatch" };
  const { signature, ...unsigned } = input;
  let valid = false;
  try {
    valid = verify(null, Buffer.from(canonicalJson(unsigned)), servicePublicKey, Buffer.from(signature, "base64url"));
  } catch { valid = false; }
  if (!valid) return { ok: false, reason: "invalid_signature" };
  if (!(await options.nonceStore.claim(input.deviceId, input.nonce, input.expiresAt, now))) return { ok: false, reason: "replay" };
  return { ok: true, request: input };
}
