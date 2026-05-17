import * as vscode from "vscode";
import { ChatPanel } from "./panel/ChatPanel";
import { secretKeyFor, SecretProvider } from "./secrets";
import { registerApplyDiffContentProvider } from "./tools/diffPreview";
import { registerOpenInEditor } from "./tools/openInEditor";

let activePanel: ChatPanel | undefined;

export async function activate(context: vscode.ExtensionContext) {
  registerApplyDiffContentProvider(context);
  registerOpenInEditor(context);
  await migratePlaintextSecrets(context);
  const panel = new ChatPanel(context);
  activePanel = panel;
  context.subscriptions.push({ dispose: () => { void panel.dispose(); } });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatPanel.viewType, panel)
  );
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      panel.notifyFilesInvalidated([doc.uri.fsPath]);
    }),
    vscode.workspace.onDidDeleteFiles((e) => {
      panel.notifyFilesInvalidated(e.files.map((u) => u.fsPath));
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("loom.open", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.loom");
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("loom.setAnthropicKey", async () => {
      await promptAndStoreSecret(context, "anthropic", "Anthropic");
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("loom.setOpenAIKey", async () => {
      await promptAndStoreSecret(context, "openai", "OpenAI");
    })
  );
}

export async function deactivate() {
  await activePanel?.dispose();
  activePanel = undefined;
}

async function migratePlaintextSecrets(context: vscode.ExtensionContext) {
  const cfg = vscode.workspace.getConfiguration();
  for (const key of ["loom.anthropicApiKey", "loom.openai.apiKey"] as const) {
    const inspected = cfg.inspect<string>(key);
    const val =
      inspected?.globalValue ??
      inspected?.workspaceValue ??
      inspected?.workspaceFolderValue ??
      cfg.get<string>(key);
    if (!val) {
      continue;
    }
    await context.secrets.store(secretKeyFor(key), val);
    if (inspected?.globalValue) {
      await cfg.update(key, "", vscode.ConfigurationTarget.Global);
    }
    if (inspected?.workspaceValue) {
      await cfg.update(key, "", vscode.ConfigurationTarget.Workspace);
    }
    if (inspected?.workspaceFolderValue) {
      await cfg.update(key, "", vscode.ConfigurationTarget.WorkspaceFolder);
    }
  }
}

async function promptAndStoreSecret(
  context: vscode.ExtensionContext,
  provider: SecretProvider,
  label: string,
) {
  const value = await vscode.window.showInputBox({
    title: `Loom: Set ${label} API Key`,
    prompt: `Enter your ${label} API key.`,
    password: true,
    ignoreFocusOut: true,
  });
  if (!value) {
    return;
  }
  await context.secrets.store(secretKeyFor(provider), value);
  void vscode.window.showInformationMessage(`${label} API key saved.`);
}
