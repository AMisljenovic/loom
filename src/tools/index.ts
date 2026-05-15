import * as vscode from "vscode";
import type { ToolCall, ToolResult } from "../shared/protocol";

export type ApprovalFn = (call: ToolCall) => Promise<boolean>;

export async function executeTool(
  call: ToolCall,
  approve: ApprovalFn
): Promise<ToolResult> {
  if (call.requiresApproval) {
    const ok = await approve(call);
    if (!ok) return { callId: call.callId, ok: false, error: "user rejected" };
  }

  try {
    switch (call.name) {
      case "write_file":
        return await writeFile(call);
      case "run_command":
        return await runCommand(call);
      default:
        return { callId: call.callId, ok: false, error: `unknown tool: ${call.name}` };
    }
  } catch (e: any) {
    return { callId: call.callId, ok: false, error: String(e?.message ?? e) };
  }
}

async function writeFile(call: ToolCall): Promise<ToolResult> {
  const { path: relPath, content } = call.input as { path: string; content: string };
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) throw new Error("no workspace folder");
  const uri = vscode.Uri.joinPath(root, relPath);
  const edit = new vscode.WorkspaceEdit();
  edit.createFile(uri, { overwrite: true, ignoreIfExists: false });
  edit.insert(uri, new vscode.Position(0, 0), content);
  await vscode.workspace.applyEdit(edit);
  await vscode.workspace.save(uri);
  return { callId: call.callId, ok: true, content: `wrote ${relPath}` };
}

async function runCommand(call: ToolCall): Promise<ToolResult> {
  const { command } = call.input as { command: string };
  // For v0.1 just show in a terminal; output capture comes later.
  const term = vscode.window.createTerminal({ name: "My Agent" });
  term.show();
  term.sendText(command);
  return {
    callId: call.callId,
    ok: true,
    content: `dispatched: ${command} (output capture not yet implemented)`,
  };
}
