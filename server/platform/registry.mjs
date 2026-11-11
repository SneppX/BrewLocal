const PLATFORM_ADAPTERS = Object.freeze({
  win32: Object.freeze({
    id: "windows",
    name: "Windows",
    pathFlavor: "windows",
    supported: true,
  }),
  darwin: Object.freeze({
    id: "macos",
    name: "macOS",
    pathFlavor: "posix",
    supported: true,
  }),
  linux: Object.freeze({
    id: "linux",
    name: "Linux",
    pathFlavor: "posix",
    supported: true,
  }),
});

export function getPlatformAdapter(platform = process.platform) {
  const adapter = PLATFORM_ADAPTERS[platform];
  if (!adapter) {
    return Object.freeze({
      id: "unsupported",
      name: "Unsupported operating system",
      pathFlavor: null,
      supported: false,
    });
  }
  return adapter;
}

export function listSupportedPlatforms() {
  return Object.values(PLATFORM_ADAPTERS).map((adapter) => ({ ...adapter }));
}
