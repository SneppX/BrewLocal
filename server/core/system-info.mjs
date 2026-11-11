import os from "node:os";
import { getPlatformAdapter } from "../platform/registry.mjs";

export function getSystemInfo() {
  const platformAdapter = getPlatformAdapter();
  return {
    platform: process.platform,
    platformId: platformAdapter.id,
    platformName: platformAdapter.name,
    platformSupported: platformAdapter.supported,
    nativeDesktopControl: "not_implemented",
    architecture: process.arch,
    operatingSystemRelease: os.release(),
    nodeVersion: process.versions.node,
    cpu: { logicalCores: os.cpus().length, model: os.cpus()[0]?.model ?? "Unknown" },
    memory: { totalBytes: os.totalmem(), freeBytes: os.freemem() },
    uptimeSeconds: Math.floor(os.uptime()),
  };
}
