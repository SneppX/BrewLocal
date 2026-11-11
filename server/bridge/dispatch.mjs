import { verifySignedRequest } from "./envelope.mjs";

async function recordAudit(audit, event) {
  if (!audit || typeof audit.record !== "function") return false;
  try {
    await audit.record({
      timestamp: new Date().toISOString(),
      deviceId: event.deviceId,
      requestId: event.requestId,
      capability: event.capability,
      operation: event.operation,
      resource: event.resource,
      risk: event.risk,
      decision: event.decision,
      resultCode: event.resultCode,
    });
    return true;
  } catch { return false; }
}

export async function dispatchSignedRequest(input, options) {
  const now = options.now ?? Date.now();
  const verified = await verifySignedRequest(input, options.servicePublicKey, {
    now,
    nonceStore: options.nonceStore,
    maxLifetimeMs: options.maxLifetimeMs ?? 60_000,
    maxClockSkewMs: options.maxClockSkewMs ?? 30_000,
  });
  if (!verified.ok) {
    await recordAudit(options.audit, {
      deviceId: options.deviceId,
      requestId: typeof input?.requestId === "string" ? input.requestId : "unknown",
      capability: "protocol",
      operation: "verify",
      resource: "signed-request",
      risk: "read",
      decision: "deny",
      resultCode: verified.reason,
    });
    return { status: "rejected", reason: verified.reason };
  }

  const request = verified.request;
  const auditBase = {
    deviceId: options.deviceId,
    requestId: request.requestId,
    capability: request.capability,
    operation: request.operation,
    resource: request.resource,
    risk: request.risk,
  };
  if (request.deviceId !== options.deviceId) {
    await recordAudit(options.audit, { ...auditBase, decision: "deny", resultCode: "wrong_device" });
    return { status: "rejected", reason: "wrong_device" };
  }

  const adapter = options.adapters?.find((candidate) =>
    candidate.capability === request.capability && candidate.operation === request.operation
  );
  if (!adapter) {
    await recordAudit(options.audit, { ...auditBase, decision: "deny", resultCode: "unsupported_capability" });
    return { status: "unsupported_capability" };
  }

  const permissionRequest = {
    requestId: request.requestId,
    capability: request.capability,
    operation: request.operation,
    resource: request.resource,
    risk: request.risk,
    argumentDigest: request.argsDigest,
  };
  let decision = options.permissions.evaluate(permissionRequest);
  const requiresFreshConfirmation = request.risk === "external" || request.risk === "destructive" || request.risk === "privileged";

  if (decision.decision === "deny") {
    await recordAudit(options.audit, { ...auditBase, decision: "deny", resultCode: decision.reason });
    return { status: "denied", reason: decision.reason };
  }

  if (decision.decision === "ask" || requiresFreshConfirmation) {
    await recordAudit(options.audit, { ...auditBase, decision: "ask", resultCode: "fresh_confirmation_required" });
    if (typeof options.requestApproval !== "function") {
      return { status: "approval_required", reason: "Fresh local user confirmation is required." };
    }
    let approved = false;
    try { approved = await options.requestApproval({ ...permissionRequest, args: request.args }); } catch { approved = false; }
    if (!approved) return { status: "approval_required", reason: "The local user did not approve this operation." };

    if (decision.decision === "ask") {
      try {
        const approval = options.permissions.createApprovalRequest(permissionRequest, request.argsDigest);
        options.permissions.grantOnce(permissionRequest, approval);
        decision = options.permissions.evaluate(permissionRequest);
      } catch {
        return { status: "approval_required", reason: "The local approval could not be bound to this request." };
      }
      if (decision.decision !== "allow") return { status: "approval_required", reason: decision.reason };
    }
  }

  if (!(await recordAudit(options.audit, { ...auditBase, decision: "allow", resultCode: "authorized" }))) {
    return { status: "failed", code: "audit_unavailable" };
  }

  let result;
  try {
    result = await adapter.execute(request.args, {
      requestId: request.requestId,
      deviceId: request.deviceId,
      resource: request.resource,
      risk: request.risk,
    });
  } catch {
    await recordAudit(options.audit, { ...auditBase, decision: "failed", resultCode: "adapter_error" });
    return { status: "failed", code: "adapter_error" };
  }

  let serialized;
  try { serialized = JSON.stringify(result); } catch {
    await recordAudit(options.audit, { ...auditBase, decision: "failed", resultCode: "invalid_result" });
    return { status: "failed", code: "invalid_result" };
  }
  if (serialized === undefined) {
    await recordAudit(options.audit, { ...auditBase, decision: "failed", resultCode: "invalid_result" });
    return { status: "failed", code: "invalid_result" };
  }
  if (Buffer.byteLength(serialized, "utf8") > (options.maxResultBytes ?? 16_384)) {
    await recordAudit(options.audit, { ...auditBase, decision: "failed", resultCode: "result_too_large" });
    return { status: "failed", code: "result_too_large" };
  }
  const auditRecorded = await recordAudit(options.audit, { ...auditBase, decision: "completed", resultCode: "ok" });
  return auditRecorded ? { status: "completed", result } : { status: "completed", result, auditWarning: true };
}
