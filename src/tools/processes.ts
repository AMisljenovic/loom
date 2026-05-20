import { Buffer } from "node:buffer";
import * as childProcess from "node:child_process";
import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import type { ProcessSnapshot, ToolCall, ToolResult } from "../shared/protocol";
import { resolveCommandCwd, resolveCommandShell, type ResolvedCommandShell } from "./commandShell";

// Ring-buffer capacity per process. Captures the most-recent N bytes of
// interleaved stdout+stderr; older bytes are dropped silently. The cursor
// returned to the agent is the monotonic byte offset from the start of the
// process, so callers can resume reading correctly even after the ring has
// wrapped (they just see "..." and a higher byte count).
const RING_BYTES = 256 * 1024;
const RETAIN_AFTER_EXIT_MS = 5 * 60 * 1000;

interface Process {
  id: string;
  command: string;
  cwd: string;
  shell: ResolvedCommandShell;
  child: childProcess.ChildProcess;
  startedAt: number;
  totalBytes: number;
  buf: Buffer;
  bufStart: number; // absolute byte offset at buf[0]
  running: boolean;
  exitCode?: number;
  exitedAt?: number;
  channel: vscode.OutputChannel;
  reapTimer?: NodeJS.Timeout;
}

const processes = new Map<string, Process>();
const listeners = new Set<() => void>();
let notifyTimer: NodeJS.Timeout | undefined;

export function runCommandBackground(call: ToolCall, workspaceRoot: string): ToolResult {
  const input = call.input as { command?: string; cwd?: string; shell?: string };
  if (typeof input.command !== "string" || !input.command.trim()) {
    return { callId: call.callId, ok: false, error: "command is required" };
  }
  const cwd = resolveCommandCwd(workspaceRoot, input.cwd);
  const shell = resolveCommandShell(input.shell);
  const id = randomUUID();
  const channel = vscode.window.createOutputChannel(`Loom - ${input.command.slice(0, 40)}`);
  channel.appendLine(`[shell: ${shell.label} (${shell.executable})]`);
  channel.appendLine(`[cwd: ${cwd}]`);
  channel.appendLine(`$ ${input.command}`);
  channel.appendLine(`(pid pending)`);
  channel.show(true);

  const child = childProcess.spawn(input.command, {
    cwd,
    shell: shell.executable,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const proc: Process = {
    id,
    command: input.command,
    cwd,
    shell,
    child,
    startedAt: Date.now(),
    totalBytes: 0,
    buf: Buffer.alloc(0),
    bufStart: 0,
    running: true,
    channel,
  };
  processes.set(id, proc);
  scheduleNotify();

  const onChunk = (data: Buffer) => {
    appendToRing(proc, data);
    channel.append(data.toString());
    scheduleNotify();
  };
  child.stdout?.on("data", onChunk);
  child.stderr?.on("data", onChunk);

  child.on("exit", (code, signal) => {
    proc.running = false;
    proc.exitCode = typeof code === "number" ? code : signal ? 1 : 0;
    proc.exitedAt = Date.now();
    const line = `\n[exit ${proc.exitCode}${signal ? ` signal=${signal}` : ""}]\n`;
    appendToRing(proc, Buffer.from(line));
    channel.append(line);
    proc.reapTimer = setTimeout(() => disposeProcess(proc.id), RETAIN_AFTER_EXIT_MS);
    scheduleNotify();
  });
  child.on("error", (err) => {
    proc.running = false;
    proc.exitCode = 1;
    proc.exitedAt = Date.now();
    const line = `\n[spawn error: ${err.message}]\n`;
    appendToRing(proc, Buffer.from(line));
    channel.append(line);
    scheduleNotify();
  });

  return {
    callId: call.callId,
    ok: true,
    content: JSON.stringify({
      processId: id,
      pid: child.pid ?? null,
      command: input.command,
      cwd,
      shell: shell.kind,
      shellExecutable: shell.executable,
    }),
  };
}

export function readProcessOutput(call: ToolCall): ToolResult {
  const input = call.input as { processId?: string; sinceCursor?: number; maxBytes?: number };
  if (typeof input.processId !== "string") {
    return { callId: call.callId, ok: false, error: "processId is required" };
  }
  const proc = processes.get(input.processId);
  if (!proc) {
    return { callId: call.callId, ok: false, error: `unknown processId: ${input.processId}` };
  }
  const since = Math.max(0, Math.floor(input.sinceCursor ?? 0));
  const maxBytes = Math.max(1, Math.floor(input.maxBytes ?? 32 * 1024));

  // Translate absolute cursor into ring offsets.
  const start = Math.max(since, proc.bufStart);
  const dropped = start - since;
  const sliceFrom = start - proc.bufStart;
  const slice = proc.buf.subarray(sliceFrom, Math.min(proc.buf.length, sliceFrom + maxBytes));
  const cursor = start + slice.length;
  const truncated = dropped > 0 ? `[…${dropped} bytes dropped, ring wrapped…]\n` : "";

  return {
    callId: call.callId,
    ok: true,
    content: JSON.stringify({
      output: truncated + slice.toString(),
      cursor,
      running: proc.running,
      exitCode: proc.exitCode ?? null,
      totalBytes: proc.totalBytes,
    }),
  };
}

export function killProcess(call: ToolCall): ToolResult {
  const input = call.input as { processId?: string };
  if (typeof input.processId !== "string") {
    return { callId: call.callId, ok: false, error: "processId is required" };
  }
  const proc = processes.get(input.processId);
  if (!proc) {
    return { callId: call.callId, ok: false, error: `unknown processId: ${input.processId}` };
  }
  if (!proc.running) {
    return { callId: call.callId, ok: true, content: `process already exited (code ${proc.exitCode ?? "?"})` };
  }
  proc.child.kill();
  scheduleNotify();
  // Force-kill if it doesn't die in 2s.
  const killTimer = setTimeout(() => {
    if (proc.running) {
      try { proc.child.kill("SIGKILL"); } catch { /* ignore */ }
    }
  }, 2000);
  proc.child.once("exit", () => clearTimeout(killTimer));
  return { callId: call.callId, ok: true, content: `kill signal sent` };
}

function appendToRing(proc: Process, chunk: Buffer) {
  proc.totalBytes += chunk.length;
  const combined = Buffer.concat([proc.buf, chunk]);
  if (combined.length <= RING_BYTES) {
    proc.buf = combined;
    return;
  }
  const overflow = combined.length - RING_BYTES;
  proc.buf = combined.subarray(overflow);
  proc.bufStart += overflow;
}

export function listProcessSnapshots(): ProcessSnapshot[] {
  return Array.from(processes.values())
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((proc) => ({
      processId: proc.id,
      command: proc.command,
      cwd: proc.cwd,
      shell: proc.shell.kind,
      shellExecutable: proc.shell.executable,
      startedAt: proc.startedAt,
      running: proc.running,
      exitCode: proc.exitCode,
      exitedAt: proc.exitedAt,
      totalBytes: proc.totalBytes,
      tailOutput: tailOutput(proc),
    }));
}

export function onProcessesChanged(listener: () => void): vscode.Disposable {
  listeners.add(listener);
  return new vscode.Disposable(() => {
    listeners.delete(listener);
  });
}

export function showProcessOutput(processId: string): boolean {
  const proc = processes.get(processId);
  if (!proc) {
    return false;
  }
  proc.channel.show(true);
  return true;
}

function scheduleNotify() {
  if (notifyTimer) {
    return;
  }
  notifyTimer = setTimeout(() => {
    notifyTimer = undefined;
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // ignore listener errors
      }
    }
  }, 120);
}

function tailOutput(proc: Process): string {
  const maxBytes = 4096;
  const start = Math.max(0, proc.buf.length - maxBytes);
  return proc.buf.subarray(start).toString();
}

function disposeProcess(id: string) {
  const proc = processes.get(id);
  if (!proc) return;
  if (proc.reapTimer) clearTimeout(proc.reapTimer);
  proc.channel.dispose();
  processes.delete(id);
  scheduleNotify();
}

export function disposeExitedProcesses() {
  for (const id of Array.from(processes.keys())) {
    const proc = processes.get(id);
    if (proc && !proc.running) {
      disposeProcess(id);
    }
  }
}

export function disposeAllProcesses() {
  for (const id of Array.from(processes.keys())) {
    const proc = processes.get(id);
    if (proc?.running) {
      try { proc.child.kill(); } catch { /* ignore */ }
    }
    disposeProcess(id);
  }
  if (notifyTimer) {
    clearTimeout(notifyTimer);
    notifyTimer = undefined;
  }
  listeners.clear();
}
