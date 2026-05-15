import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { McpConfig, McpServerConfig } from "./shared/protocol";

export interface ResolveMcpConfigOptions {
  workspaceRoot: string;
  settingsServers?: unknown;
  userConfigDir?: string;
  readFile?: (filePath: string) => string | undefined;
}

export function resolveMcpConfig(options: ResolveMcpConfigOptions): McpConfig {
  const readFile = options.readFile ?? readFileIfExists;
  const workspaceConfig = options.workspaceRoot
    ? parseMcpFile(readFile(path.join(options.workspaceRoot, ".vscode", "mcp.json")))
    : { servers: {} };
  const settingsConfig = parseServersObject(options.settingsServers);
  const userConfig = parseMcpFile(
    readFile(path.join(options.userConfigDir ?? defaultUserConfigDir(), "mcp", "servers.json")),
  );

  const merged: Record<string, McpServerConfig> = {};
  for (const source of [workspaceConfig.servers, settingsConfig.servers, userConfig.servers]) {
    for (const [name, server] of Object.entries(source)) {
      if (!(name in merged)) {
        merged[name] = substituteWorkspaceFolder(server, options.workspaceRoot);
      }
    }
  }
  return { servers: merged };
}

function parseMcpFile(raw: string | undefined): McpConfig {
  if (!raw) return { servers: {} };
  try {
    return parseMcpConfigObject(JSON.parse(raw));
  } catch {
    return { servers: {} };
  }
}

function parseMcpConfigObject(value: unknown): McpConfig {
  if (typeof value !== "object" || value === null) return { servers: {} };
  const servers = (value as { servers?: unknown }).servers;
  return parseServersObject(servers);
}

function parseServersObject(value: unknown): McpConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { servers: {} };
  }
  const servers: Record<string, McpServerConfig> = {};
  for (const [name, rawServer] of Object.entries(value)) {
    const server = normalizeServer(rawServer);
    if (server) {
      servers[name] = server;
    }
  }
  return { servers };
}

function normalizeServer(value: unknown): McpServerConfig | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.command !== "string" || !raw.command.trim()) {
    return undefined;
  }
  const args = Array.isArray(raw.args)
    ? raw.args.filter((arg): arg is string => typeof arg === "string")
    : [];
  const env: Record<string, string> = {};
  if (typeof raw.env === "object" && raw.env !== null && !Array.isArray(raw.env)) {
    for (const [key, val] of Object.entries(raw.env)) {
      if (typeof val === "string") {
        env[key] = val;
      }
    }
  }
  return { command: raw.command, args, env };
}

function substituteWorkspaceFolder(server: McpServerConfig, workspaceRoot: string): McpServerConfig {
  const replace = (value: string) => value.replaceAll("${workspaceFolder}", workspaceRoot);
  return {
    command: replace(server.command),
    args: server.args?.map(replace) ?? [],
    env: Object.fromEntries(Object.entries(server.env ?? {}).map(([key, value]) => [key, replace(value)])),
  };
}

function readFileIfExists(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function defaultUserConfigDir(): string {
  if (process.platform === "win32") {
    return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support");
  }
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
}
