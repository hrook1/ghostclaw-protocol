export function commandInvocation(command, args, options = {}) {
  const platform = options.platform ?? process.platform;
  const windowsShim = platform === "win32" && command.toLowerCase().endsWith(".cmd");
  if (!windowsShim) return { command, args };
  return {
    command: options.comSpec || process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", command, ...args],
  };
}
