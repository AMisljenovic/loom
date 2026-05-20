import * as nodePath from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCommandCwd, resolveCommandShell } from "./commandShell";

describe("resolveCommandShell", () => {
  it("defaults Windows auto commands to PowerShell", () => {
    const shell = resolveCommandShell(undefined, { platform: "win32" });

    expect(shell).toMatchObject({
      requested: "auto",
      kind: "powershell",
      executable: "powershell.exe",
      label: "PowerShell",
    });
  });

  it("allows explicit cmd on Windows", () => {
    const shell = resolveCommandShell("cmd", { platform: "win32" });

    expect(shell).toMatchObject({
      requested: "cmd",
      kind: "cmd",
      executable: "cmd.exe",
      label: "Command",
    });
  });

  it("prefers bash for Unix auto when /bin/bash exists", () => {
    const shell = resolveCommandShell("auto", {
      platform: "linux",
      fileExists: (path) => path === "/bin/bash",
    });

    expect(shell).toMatchObject({
      requested: "auto",
      kind: "bash",
      executable: "/bin/bash",
      label: "Bash",
    });
  });

  it("falls back to sh for Unix auto when bash is missing", () => {
    const shell = resolveCommandShell("auto", {
      platform: "darwin",
      fileExists: (path) => path === "/bin/sh",
    });

    expect(shell).toMatchObject({
      requested: "auto",
      kind: "sh",
      executable: "/bin/sh",
      label: "Sh",
    });
  });

  it("returns a clear error for unavailable non-Windows PowerShell", () => {
    expect(() => resolveCommandShell("powershell", {
      platform: "linux",
      envPath: "/usr/local/bin:/usr/bin",
      fileExists: () => false,
    })).toThrow('shell "powershell" requires pwsh on this platform');
  });

  it("returns a clear error for unavailable explicit POSIX shells", () => {
    expect(() => resolveCommandShell("bash", {
      platform: "win32",
      envPath: "C:\\Windows\\System32",
      fileExists: () => false,
    })).toThrow('shell "bash" is unavailable on this host');
  });

  it("rejects unknown shell names", () => {
    expect(() => resolveCommandShell("fish")).toThrow("shell must be one of");
  });
});

describe("resolveCommandCwd", () => {
  it("resolves workspace-relative cwd values", () => {
    const root = nodePath.resolve("workspace");

    expect(resolveCommandCwd(root, "agent")).toBe(nodePath.resolve(root, "agent"));
  });

  it("defaults to the workspace root", () => {
    const root = nodePath.resolve("workspace");

    expect(resolveCommandCwd(root, undefined)).toBe(root);
  });

  it("rejects absolute cwd values", () => {
    const root = nodePath.resolve("workspace");

    expect(() => resolveCommandCwd(root, nodePath.resolve("elsewhere"))).toThrow("cwd must be relative");
  });

  it("rejects cwd values that escape the workspace", () => {
    const root = nodePath.resolve("workspace");

    expect(() => resolveCommandCwd(root, "../outside")).toThrow("cwd escapes workspace root");
  });
});
