import * as vscode from "vscode";
import { ChatPanel } from "./panel/ChatPanel";

export function activate(context: vscode.ExtensionContext) {
  const panel = new ChatPanel(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatPanel.viewType, panel)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("myAgent.open", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.myAgent");
    })
  );
}

export function deactivate() {
  // child process killed via extension subscription cleanup is enough for v0.1
}
