import { Buffer } from "node:buffer";
import * as childProcess from "node:child_process";
import * as nodePath from "node:path";
import * as vscode from "vscode";
import type { ToolCall, ToolFollowup, ToolFollowupDiagRow, ToolResult } from "../shared/protocol";
import { recoverableApplyDiffError } from "./applyDiffRecovery";
import { killProcess, readProcessOutput, runCommandBackground } from "./processes";

export type ApprovalFn = (call: ToolCall) => Promise<boolean>;

export interface ToolContext {
  workspaceRoot: string;
  onProgress?: (chunk: string) => void;
}

interface ApplyDiffEdit {
  oldText: string;
  newText: string;
}

interface ApplyDiffInput {
  path: string;
  edits: ApplyDiffEdit[];
}

interface ExecError {
  killed?: boolean;
  code?: number | string;
  signal?: string | null;
}

export interface PreparedApplyDiff {
  callId: string;
  relPath: string;
  uri: vscode.Uri;
  existed: boolean;
  before: string;
  after: string;
  // Pre-edit diagnostics keyed by URI string — used to diff against the
  // post-edit snapshot so the feedback loop only surfaces *new* problems.
  preDiagnostics: Map<string, DiagFingerprint[]>;
}

interface DiagFingerprint {
  line: number;
  col: number;
  severity: ToolFollowupDiagRow["severity"];
  message: string;
}

const preparedApplyDiffs = new Map<string, PreparedApplyDiff>();
const POST_EDIT_SETTLE_MS = 750;

export async function executeTool(
  call: ToolCall,
  approve: ApprovalFn,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (call.requiresApproval) {
    const ok = await approve(call);
    if (!ok) return { callId: call.callId, ok: false, error: "user rejected" };
  }

  try {
    switch (call.name) {
      case "get_diagnostics":
        return getDiagnostics(call, ctx);
      case "apply_diff":
        return await applyDiff(call, ctx);
      case "run_command":
        return await runCommand(call, ctx);
      case "run_command_background":
        return runCommandBackground(call, resolveWorkspaceRoot(ctx));
      case "read_process_output":
        return readProcessOutput(call);
      case "kill_process":
        return killProcess(call);
      default:
        return { callId: call.callId, ok: false, error: `unknown tool: ${call.name}` };
    }
  } catch (e: unknown) {
    return { callId: call.callId, ok: false, error: getErrorMessage(e) };
  }
}

export async function prepareApplyDiff(
  call: ToolCall,
  ctx: ToolContext,
): Promise<PreparedApplyDiff> {
  const input = parseApplyDiffInput(call.input);
  const root = resolveWorkspaceRoot(ctx);
  const uri = resolveWorkspaceFile(root, input.path);

  const read = await readTextIfExists(uri);
  const existed = read !== undefined;
  if (!existed) {
    if (input.edits.length !== 1 || input.edits[0].oldText !== "") {
      throw new Error("new files require exactly one edit with oldText empty and newText as the full file content");
    }
    return {
      callId: call.callId,
      relPath: input.path,
      uri,
      existed: false,
      before: "",
      after: input.edits[0].newText,
      preDiagnostics: new Map(),
    };
  }

  let after = read;
  input.edits.forEach((edit, index) => {
    if (edit.oldText === "") {
      throw new Error(`edit ${index + 1}: oldText must not be empty for existing files`);
    }
    const occurrences = countOccurrences(after, edit.oldText);
    if (occurrences === 0) {
      throw new Error(recoverableApplyDiffError(input.path, index + 1, "oldText not found"));
    }
    if (occurrences > 1) {
      throw new Error(recoverableApplyDiffError(input.path, index + 1, `oldText found ${occurrences} times`));
    }
    after = after.replace(edit.oldText, edit.newText);
  });

  return {
    callId: call.callId,
    relPath: input.path,
    uri,
    existed: true,
    before: read,
    after,
    preDiagnostics: snapshotDiagnostics([uri]),
  };
}

function snapshotDiagnostics(uris: vscode.Uri[]): Map<string, DiagFingerprint[]> {
  const out = new Map<string, DiagFingerprint[]>();
  for (const uri of uris) {
    const fps = vscode.languages.getDiagnostics(uri).map(fingerprint);
    out.set(uri.toString(), fps);
  }
  return out;
}

function fingerprint(d: vscode.Diagnostic): DiagFingerprint {
  return {
    line: d.range.start.line + 1,
    col: d.range.start.character + 1,
    severity: severityToFollowup(d.severity),
    message: d.message,
  };
}

function severityToFollowup(sev: vscode.DiagnosticSeverity): ToolFollowupDiagRow["severity"] {
  switch (sev) {
    case vscode.DiagnosticSeverity.Error: return "error";
    case vscode.DiagnosticSeverity.Warning: return "warning";
    case vscode.DiagnosticSeverity.Information: return "info";
    default: return "hint";
  }
}

function diffDiagnostics(before: DiagFingerprint[], after: DiagFingerprint[]): DiagFingerprint[] {
  const seen = new Set(before.map((d) => `${d.line}:${d.col}:${d.severity}:${d.message}`));
  return after.filter((d) => !seen.has(`${d.line}:${d.col}:${d.severity}:${d.message}`));
}


export function cachePreparedApplyDiff(plan: PreparedApplyDiff) {
  preparedApplyDiffs.set(plan.callId, plan);
}

export function discardPreparedApplyDiff(callId: string) {
  preparedApplyDiffs.delete(callId);
}

function resolveWorkspaceRoot(ctx: ToolContext): string {
  if (ctx.workspaceRoot) return ctx.workspaceRoot;
  const fromVscode = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (fromVscode) return fromVscode;
  throw new Error("no workspace folder");
}

function resolveWorkspaceFile(root: string, relPath: string): vscode.Uri {
  if (!relPath || nodePath.isAbsolute(relPath)) {
    throw new Error("path must be relative to the workspace root");
  }
  const full = nodePath.resolve(root, relPath);
  const rootResolved = nodePath.resolve(root);
  if (full !== rootResolved && !full.startsWith(rootResolved + nodePath.sep)) {
    throw new Error("path escapes workspace root");
  }
  return vscode.Uri.file(full);
}

function getDiagnostics(call: ToolCall, ctx: ToolContext): ToolResult {
  const input = call.input as { path?: string; severity?: "error" | "warning" | "all" };
  const root = resolveWorkspaceRoot(ctx);
  const severity = input.severity ?? "all";
  const entries = input.path
    ? vscode.languages.getDiagnostics(resolveWorkspaceFile(root, input.path)).map((diagnostic) => ({
      uri: resolveWorkspaceFile(root, input.path ?? ""),
      diagnostic,
    }))
    : vscode.languages.getDiagnostics().flatMap(([uri, diagnostics]) =>
      diagnostics.map((diagnostic) => ({ uri, diagnostic }))
    );

  const filtered = entries.filter(({ diagnostic }) => {
    if (severity === "all") return true;
    if (severity === "error") return diagnostic.severity === vscode.DiagnosticSeverity.Error;
    return diagnostic.severity === vscode.DiagnosticSeverity.Warning;
  });

  const capped = filtered.slice(0, 200);
  const lines = capped.map(({ uri, diagnostic }) => {
    const relPath = nodePath.relative(root, uri.fsPath) || uri.fsPath;
    const line = diagnostic.range.start.line + 1;
    const col = diagnostic.range.start.character + 1;
    const sev = severityLabel(diagnostic.severity);
    const source = diagnostic.source ? ` (${diagnostic.source})` : "";
    return `${relPath}:${line}:${col} [${sev}] ${diagnostic.message}${source}`;
  });
  if (filtered.length > capped.length) {
    lines.push(`(truncated, showing ${capped.length} of ${filtered.length} diagnostics)`);
  }
  if (lines.length === 0) {
    lines.push("no diagnostics");
  }

  return { callId: call.callId, ok: true, content: lines.join("\n") };
}

async function applyDiff(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
  const plan = preparedApplyDiffs.get(call.callId) ?? await prepareApplyDiff(call, ctx);
  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(nodePath.dirname(plan.uri.fsPath)));
    const edit = new vscode.WorkspaceEdit();
    let content: string;
    if (plan.existed) {
      const doc = await vscode.workspace.openTextDocument(plan.uri);
      const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
      edit.replace(plan.uri, fullRange, plan.after);
      await vscode.workspace.applyEdit(edit);
      await doc.save();
      content = `applied diff to ${plan.relPath}`;
    } else {
      edit.createFile(plan.uri, { overwrite: false, ignoreIfExists: false });
      edit.insert(plan.uri, new vscode.Position(0, 0), plan.after);
      await vscode.workspace.applyEdit(edit);
      const doc = await vscode.workspace.openTextDocument(plan.uri);
      await doc.save();
      content = `created ${plan.relPath}`;
    }
    const followups = await collectDiagnosticsFollowups(plan);
    return { callId: call.callId, ok: true, content, followups: followups.length ? followups : undefined };
  } finally {
    discardPreparedApplyDiff(call.callId);
  }
}

async function collectDiagnosticsFollowups(plan: PreparedApplyDiff): Promise<ToolFollowup[]> {
  await new Promise((resolve) => setTimeout(resolve, POST_EDIT_SETTLE_MS));
  const post = snapshotDiagnostics([plan.uri]);
  const out: ToolFollowup[] = [];
  for (const [uriKey, after] of post) {
    const before = plan.preDiagnostics.get(uriKey) ?? [];
    const newDiags = diffDiagnostics(before, after).filter((d) => d.severity === "error" || d.severity === "warning");
    if (newDiags.length === 0) continue;
    out.push({ kind: "diagnostics", path: plan.relPath, diags: newDiags });
  }
  return out;
}

function parseApplyDiffInput(input: unknown): ApplyDiffInput {
  const candidate = input as Partial<ApplyDiffInput>;
  if (typeof candidate.path !== "string" || !Array.isArray(candidate.edits)) {
    throw new Error("apply_diff requires path and edits");
  }
  const edits = candidate.edits.map((edit) => {
    const e = edit as Partial<ApplyDiffEdit>;
    if (typeof e.oldText !== "string" || typeof e.newText !== "string") {
      throw new Error("each edit requires oldText and newText strings");
    }
    return { oldText: e.oldText, newText: e.newText };
  });
  return { path: candidate.path, edits };
}

async function readTextIfExists(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString("utf8");
  } catch (e: unknown) {
    if (isFileNotFound(e)) return undefined;
    throw e;
  }
}

function isFileNotFound(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "FileNotFound";
}

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

function severityLabel(severity: vscode.DiagnosticSeverity): string {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return "error";
    case vscode.DiagnosticSeverity.Warning:
      return "warning";
    case vscode.DiagnosticSeverity.Information:
      return "info";
    case vscode.DiagnosticSeverity.Hint:
      return "hint";
    default:
      return "unknown";
  }
}

let outputChannel: vscode.OutputChannel | undefined;
function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("Loom - Commands");
  }
  return outputChannel;
}

const COMMAND_TIMEOUT_MS = 120_000;
const COMMAND_MAX_BUFFER = 1024 * 1024;
const STREAM_TAIL_CHARS = 8000;

async function runCommand(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
  const { command } = call.input as { command: string };
  const cwd = ctx.workspaceRoot || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const channel = getOutputChannel();
  const progress = createProgressEmitter(ctx.onProgress);
  channel.show(true);
  channel.appendLine(`$ ${command}`);
  progress.push(`$ ${command}\n`);

  const result = await new Promise<{ stdout: string; stderr: string; code: number; timedOut: boolean }>((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = childProcess.exec(
      command,
      { cwd, timeout: COMMAND_TIMEOUT_MS, maxBuffer: COMMAND_MAX_BUFFER, windowsHide: true },
      (err) => {
        const execErr = err as ExecError | null;
        const timedOut = !!(execErr && execErr.signal === "SIGTERM" && execErr.killed);
        let code: number;
        if (execErr && typeof execErr.code === "number") {
          code = execErr.code;
        } else if (err) {
          code = 1;
        } else {
          code = 0;
        }
        resolve({ stdout, stderr, code, timedOut });
      }
    );
    child.stdout?.on("data", (d: Buffer | string) => {
      const s = d.toString();
      stdout += s;
      channel.append(s);
      progress.push(s);
    });
    child.stderr?.on("data", (d: Buffer | string) => {
      const s = d.toString();
      stderr += s;
      channel.append(s);
      progress.push(s);
    });
  });

  const exitLine = `\n[exit ${result.code}${result.timedOut ? " - timed out" : ""}]\n`;
  channel.append(exitLine);
  progress.push(exitLine);
  progress.flush();

  const tail = (s: string) =>
    s.length > STREAM_TAIL_CHARS ? `...(truncated)\n${s.slice(-STREAM_TAIL_CHARS)}` : s;

  const parts = [`exit code: ${result.code}${result.timedOut ? " (timed out)" : ""}`];
  if (result.stdout) parts.push(`stdout:\n${tail(result.stdout)}`);
  if (result.stderr) parts.push(`stderr:\n${tail(result.stderr)}`);

  return {
    callId: call.callId,
    ok: result.code === 0 && !result.timedOut,
    content: parts.join("\n\n"),
  };
}

function createProgressEmitter(onProgress: ((chunk: string) => void) | undefined) {
  let pending = "";
  let timer: NodeJS.Timeout | undefined;
  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (!pending) return;
    onProgress?.(pending);
    pending = "";
  };
  return {
    push(chunk: string) {
      if (!onProgress) return;
      pending += chunk;
      if (!timer) {
        timer = setTimeout(flush, 50);
      }
    },
    flush,
  };
}

function getErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
