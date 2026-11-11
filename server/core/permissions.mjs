export const PermissionMode = Object.freeze({
  DENY: "deny",
  ASK: "ask",
  SESSION: "session",
  ALWAYS: "always",
});

export const RiskLevel = Object.freeze({
  READ: "read",
  WRITE: "write",
  DESTRUCTIVE: "destructive",
  PRIVILEGED: "privileged",
  EXTERNAL: "external",
});

const validModes = new Set(Object.values(PermissionMode));
const validRisks = new Set(Object.values(RiskLevel));

export function validatePolicy(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Permission policy must be an object.");
  }
  const { capability, operation, resource = "*", mode } = input;
  for (const [field, value] of Object.entries({ capability, operation, resource })) {
    if (typeof value !== "string" || value.trim().length === 0 || value.length > 512) {
      throw new TypeError(`Permission policy ${field} must be a non-empty string of at most 512 characters.`);
    }
  }
  if (!validModes.has(mode)) throw new TypeError(`Unsupported permission mode: ${mode}`);
  return Object.freeze({ capability: capability.trim(), operation: operation.trim(), resource: resource.trim(), mode });
}

export function makePermissionRequest(input) {
  if (!input || typeof input !== "object") throw new TypeError("Permission request must be an object.");
  const { capability, operation, resource = "*", risk = RiskLevel.READ, requiresElevation = false } = input;
  if (typeof capability !== "string" || !capability.trim()) throw new TypeError("Permission capability is required.");
  if (typeof operation !== "string" || !operation.trim()) throw new TypeError("Permission operation is required.");
  if (typeof resource !== "string" || !resource.trim()) throw new TypeError("Permission resource is required.");
  if (!validRisks.has(risk)) throw new TypeError(`Unsupported risk level: ${risk}`);
  return Object.freeze({ capability: capability.trim(), operation: operation.trim(), resource: resource.trim(), risk, requiresElevation: Boolean(requiresElevation) });
}

const matches = (pattern, value) => pattern === "*" || pattern === value;
const specificity = (policy) => Number(policy.capability !== "*") + Number(policy.operation !== "*") + Number(policy.resource !== "*");

export function findMatchingPolicy(policies, request) {
  return policies.map(validatePolicy).filter((policy) =>
    matches(policy.capability, request.capability) &&
    matches(policy.operation, request.operation) &&
    matches(policy.resource, request.resource)
  ).sort((a, b) => {
    const delta = specificity(b) - specificity(a);
    if (delta) return delta;
    if (a.mode === PermissionMode.DENY && b.mode !== PermissionMode.DENY) return -1;
    if (b.mode === PermissionMode.DENY && a.mode !== PermissionMode.DENY) return 1;
    return 0;
  })[0] ?? null;
}

export class PermissionManager {
  #policies = [];
  #sessionGrants = new Set();
  #oneTimeGrants = new Set();

  constructor(policies = []) { this.replacePolicies(policies); }

  replacePolicies(policies) {
    if (!Array.isArray(policies)) throw new TypeError("Permission policies must be an array.");
    this.#policies = policies.map(validatePolicy);
    this.#sessionGrants.clear();
    this.#oneTimeGrants.clear();
  }

  listPolicies() { return this.#policies.map((policy) => ({ ...policy })); }

  setPolicy(policy) {
    const normalized = validatePolicy(policy);
    this.#policies = this.#policies.filter((existing) => !(
      existing.capability === normalized.capability &&
      existing.operation === normalized.operation &&
      existing.resource === normalized.resource
    ));
    this.#policies.push(normalized);
    this.#sessionGrants.clear();
    this.#oneTimeGrants.clear();
    return normalized;
  }

  grantOnce(request) {
    const normalized = makePermissionRequest(request);
    if (normalized.capability === "*" || normalized.operation === "*" || normalized.resource === "*") {
      throw new TypeError("One-time approvals must target an exact capability, operation and resource.");
    }
    this.#oneTimeGrants.add(this.#key(normalized));
  }

  grantForSession(request) {
    const normalized = makePermissionRequest(request);
    if (normalized.capability === "*" || normalized.operation === "*" || normalized.resource === "*") {
      throw new TypeError("Session grants must target an exact capability, operation and resource.");
    }
    this.#sessionGrants.add(this.#key(normalized));
  }

  revokeSessionGrants() { this.#sessionGrants.clear(); this.#oneTimeGrants.clear(); }

  evaluate(input) {
    const request = makePermissionRequest(input);
    const policy = findMatchingPolicy(this.#policies, request);
    if (!policy || policy.mode === PermissionMode.DENY) {
      return { decision: "deny", reason: "No applicable allow policy." };
    }
    if (request.requiresElevation || request.risk === RiskLevel.PRIVILEGED) {
      return { decision: "ask", reason: "Operating-system elevation requires separate authorization." };
    }
    if (request.risk === RiskLevel.DESTRUCTIVE) {
      return { decision: "ask", reason: "Destructive operations always require fresh confirmation." };
    }
    const key = this.#key(request);
    if (policy.mode === PermissionMode.ASK) {
      if (this.#oneTimeGrants.delete(key)) return { decision: "allow", reason: "One-time approval consumed." };
      return { decision: "ask", reason: "This operation requires fresh user approval." };
    }
    if (policy.mode === PermissionMode.SESSION) {
      return this.#sessionGrants.has(key)
        ? { decision: "allow", reason: "An exact session grant exists." }
        : { decision: "ask", reason: "Session approval is required." };
    }
    if (policy.mode === PermissionMode.ALWAYS) return { decision: "allow", reason: "An explicit persistent policy allows this operation." };
    return { decision: "deny", reason: "Unsupported permission policy." };
  }

  #key(request) { return `${request.capability}\u0000${request.operation}\u0000${request.resource}`; }
}
