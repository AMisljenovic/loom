import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveMcpConfig } from "./mcpConfig";

describe("resolveMcpConfig", () => {
  it("merges sources with first-wins precedence", () => {
    const workspaceRoot = "/repo";
    const userConfigDir = "/user-config";
    const files = new Map<string, string>([
      [path.join(workspaceRoot, ".vscode", "mcp.json"), JSON.stringify({
        servers: {
          fs: { command: "workspace-fs" },
        },
      })],
      [path.join(userConfigDir, "mcp", "servers.json"), JSON.stringify({
        servers: {
          github: { command: "user-gh" },
          db: { command: "user-db" },
        },
      })],
    ]);

    const cfg = resolveMcpConfig({
      workspaceRoot,
      userConfigDir,
      settingsServers: {
        fs: { command: "settings-fs" },
        github: { command: "settings-gh" },
      },
      readFile: (filePath) => files.get(filePath),
    });

    expect(cfg.servers.fs.command).toBe("workspace-fs");
    expect(cfg.servers.github.command).toBe("settings-gh");
    expect(cfg.servers.db.command).toBe("user-db");
  });

  it("substitutes workspaceFolder in command args and env", () => {
    const workspaceRoot = "/repo";
    const cfg = resolveMcpConfig({
      workspaceRoot,
      userConfigDir: "/none",
      settingsServers: {
        fs: {
          command: "${workspaceFolder}/server",
          args: ["--root", "${workspaceFolder}"],
          env: { ROOT: "${workspaceFolder}" },
        },
      },
      readFile: () => undefined,
    });

    expect(cfg.servers.fs.command).toBe("/repo/server");
    expect(cfg.servers.fs.args).toEqual(["--root", "/repo"]);
    expect(cfg.servers.fs.env?.ROOT).toBe("/repo");
  });
});
