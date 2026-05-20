import * as fs from "node:fs";
import * as nodePath from "node:path";

export type CommandShellKind = "auto" | "powershell" | "cmd" | "bash" | "sh";

export interface ResolvedCommandShell {
  requested: CommandShellKind;
  kind: Exclude<CommandShellKind, "auto">;
  executable: string;
  label: string;
}

interface ResolveShellOptions {
  platform?: NodeJS.Platform;
  envPath?: string;
  pathExt?: string;
  fileExists?: (path: string) => boolean;
}

const SHELLS = new Set<CommandShellKind>(["auto", "powershell", "cmd", "bash", "sh"]);

export function resolveCommandShell(input: unknown, opts: ResolveShellOptions = {}): ResolvedCommandShell {
  const requested = parseCommandShell(input);
  const platform = opts.platform ?? process.platform;
  const fileExists = opts.fileExists ?? fs.existsSync;

  if (platform === "win32") {
    switch (requested) {
      case "auto":
      case "powershell":
        return { requested, kind: "powershell", executable: "powershell.exe", label: "PowerShell" };
      case "cmd":
        return { requested, kind: "cmd", executable: "cmd.exe", label: "Command" };
      case "bash": {
        const executable = findOnPath("bash", platform, opts, fileExists);
        if (!executable) throw new Error('shell "bash" is unavailable on this host');
        return { requested, kind: "bash", executable, label: "Bash" };
      }
      case "sh": {
        const executable = findOnPath("sh", platform, opts, fileExists);
        if (!executable) throw new Error('shell "sh" is unavailable on this host');
        return { requested, kind: "sh", executable, label: "Sh" };
      }
    }
  }

  switch (requested) {
    case "auto":
      return fileExists("/bin/bash")
        ? { requested, kind: "bash", executable: "/bin/bash", label: "Bash" }
        : { requested, kind: "sh", executable: "/bin/sh", label: "Sh" };
    case "powershell": {
      const executable = findOnPath("pwsh", platform, opts, fileExists);
      if (!executable) throw new Error('shell "powershell" requires pwsh on this platform');
      return { requested, kind: "powershell", executable, label: "PowerShell" };
    }
    case "cmd":
      throw new Error('shell "cmd" is only supported on Windows');
    case "bash": {
      const executable = fileExists("/bin/bash") ? "/bin/bash" : findOnPath("bash", platform, opts, fileExists);
      if (!executable) throw new Error('shell "bash" is unavailable on this host');
      return { requested, kind: "bash", executable, label: "Bash" };
    }
    case "sh": {
      const executable = fileExists("/bin/sh") ? "/bin/sh" : findOnPath("sh", platform, opts, fileExists);
      if (!executable) throw new Error('shell "sh" is unavailable on this host');
      return { requested, kind: "sh", executable, label: "Sh" };
    }
  }
}

export function resolveCommandCwd(workspaceRoot: string, input: unknown): string {
  if (input === undefined || input === null || input === "") {
    return nodePath.resolve(workspaceRoot);
  }
  if (typeof input !== "string") {
    throw new Error("cwd must be a workspace-relative path");
  }
  if (nodePath.isAbsolute(input)) {
    throw new Error("cwd must be relative to the workspace root");
  }
  const root = nodePath.resolve(workspaceRoot);
  const full = nodePath.resolve(root, input);
  if (!isInsideOrEqual(full, root)) {
    throw new Error("cwd escapes workspace root");
  }
  return full;
}

function parseCommandShell(input: unknown): CommandShellKind {
  if (input === undefined || input === null || input === "") {
    return "auto";
  }
  if (typeof input === "string" && SHELLS.has(input as CommandShellKind)) {
    return input as CommandShellKind;
  }
  throw new Error('shell must be one of "auto", "powershell", "cmd", "bash", or "sh"');
}

function findOnPath(
  command: string,
  platform: NodeJS.Platform,
  opts: ResolveShellOptions,
  fileExists: (path: string) => boolean,
): string | undefined {
  const envPath = opts.envPath ?? process.env.PATH ?? "";
  const delimiter = platform === "win32" ? ";" : ":";
  const dirs = envPath.split(delimiter).filter(Boolean);
  const names = executableNames(command, platform, opts.pathExt);
  for (const dir of dirs) {
    for (const name of names) {
      if (fileExists(nodePath.join(dir, name))) {
        return name;
      }
    }
  }
  return undefined;
}

function executableNames(command: string, platform: NodeJS.Platform, pathExt: string | undefined): string[] {
  if (platform !== "win32" || nodePath.extname(command)) {
    return [command];
  }
  const exts = (pathExt ?? process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
    .split(";")
    .map((ext) => ext.trim())
    .filter(Boolean);
  return [command, ...exts.map((ext) => `${command}${ext.toLowerCase()}`), ...exts.map((ext) => `${command}${ext.toUpperCase()}`)];
}

function isInsideOrEqual(full: string, root: string): boolean {
  const normalizedFull = normalizeForCompare(full);
  const normalizedRoot = normalizeForCompare(root);
  return normalizedFull === normalizedRoot || normalizedFull.startsWith(normalizedRoot + nodePath.sep);
}

function normalizeForCompare(path: string): string {
  const normalized = nodePath.normalize(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
