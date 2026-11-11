import os from "node:os";

export function getSystemInfo() {
  return {
    platform: process.platform,
    platformName: process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : process.platform === "linux" ? "Linux" : "Unsupported",
    architecture: process.arch,
    operatingSystemRelease: os.release(),
    nodeVersion: process.versions.node,
    cpu: { logicalCores: os.cpus().length, model: os.cpus()[0]?.model ?? "Unknown" },
    memory: { totalBytes: os.totalmem(), freeBytes: os.freemem() },
    uptimeSeconds: Math.floor(os.uptime()),
  };
}
