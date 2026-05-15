import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { AgentClient, LlmConfig, LlmProvider } from "../agentClient";
import { loadDotEnv } from "../env";
import type {
  HostToWebview,
  ToolCall,
  WebviewToHost,
} from "../shared/protocol";
import { executeTool } from "../tools";

export class ChatPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = "myAgent.chat";

  private view?: vscode.WebviewView;
  private agent?: AgentClient;
  private pendingApprovals = new Map<string, (ok: boolean) => void>();

  constructor(private readonly ctx: vscode.ExtensionContext) { }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, "dist", "webview")],
    };
    view.webview.html = this.getHtml(view.webview);
    view.webview.onDidReceiveMessage((m: WebviewToHost) => this.onWebviewMessage(m));
  }

  private post(msg: HostToWebview) {
    this.view?.webview.postMessage(msg);
  }

  private async onWebviewMessage(m: WebviewToHost) {
    if (m.type === "submit") {
      await this.runTask(m.prompt);
    } else if (m.type === "cancel") {
      // taskId tracking left as exercise; v0.1 single-task
      this.agent?.cancel("current");
    } else if (m.type === "approve") {
      this.pendingApprovals.get(m.callId)?.(m.approved);
      this.pendingApprovals.delete(m.callId);
    }
  }

  private async runTask(prompt: string) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    if (!this.agent) {
      const cfg = this.resolveLlmConfig(workspaceRoot, this.ctx.extensionPath);
      if ("error" in cfg) {
        this.post({ type: "error", error: cfg.error });
        return;
      }
      this.agent = new AgentClient(this.ctx.extensionPath, {
        onDelta: ({ text }) => this.post({ type: "delta", text }),
        onToolCall: async (call: ToolCall) => {
          if (call.requiresApproval) {
            this.post({ type: "toolCall", call });
            const approved = await new Promise<boolean>((resolve) => {
              this.pendingApprovals.set(call.callId, resolve);
            });
            if (!approved) {
              this.post({ type: "toolResult", callId: call.callId, ok: false, summary: "rejected" });
              return { callId: call.callId, ok: false, error: "user rejected" };
            }
          }
          const result = await executeTool(call, async () => true);
          this.post({
            type: "toolResult",
            callId: call.callId,
            ok: result.ok,
            summary: result.content ?? result.error ?? "",
          });
          return result;
        },
        onDone: ({ reason }) => this.post({ type: "done", reason }),
        onError: (error) => this.post({ type: "error", error }),
      });
      await this.agent.start(cfg);
    }

    await this.agent.startTask({
      taskId: randomUUID(),
      prompt,
      workspaceRoot,
      cwd: workspaceRoot,
    });
  }

  // Resolves LLM config from VS Code settings, the workspace .env file, and
  // process.env (in that precedence). Returns either the validated config or
  // a user-facing error message. extensionPath is used as a fallback location
  // for .env so developers running the extension via F5 in this repo get
  // their .env picked up even if no workspace folder is open.
  private resolveLlmConfig(
    workspaceRoot: string,
    extensionPath: string,
  ): LlmConfig | { error: string } {
    const settings = vscode.workspace.getConfiguration("myAgent");
    let dotenv = loadDotEnv(workspaceRoot);
    let dotenvSource = workspaceRoot;
    if (Object.keys(dotenv).length === 0 && extensionPath) {
      dotenv = loadDotEnv(extensionPath);
      dotenvSource = extensionPath;
    }
    // Use inspect() so the package.json `default` value never beats .env —
    // settings only "win" when the user has explicitly set them somewhere.
    const pick = (settingKey: string, envKey: string): string => {
      const ins = settings.inspect<string>(settingKey);
      const explicit =
        ins?.workspaceFolderValue ??
        ins?.workspaceValue ??
        ins?.globalValue;
      if (explicit) return explicit;
      if (dotenv[envKey]) return dotenv[envKey];
      return process.env[envKey] ?? "";
    };

    const provider = (pick("provider", "MY_AGENT_PROVIDER") || "anthropic") as LlmProvider;

    const dotenvFound = Object.keys(dotenv).length > 0;
    console.error(
      `[loom] resolveLlmConfig: workspaceRoot=${workspaceRoot || "<none>"} ` +
      `.env=${dotenvFound ? `loaded from ${dotenvSource}` : "missing"} provider=${provider}`
    );

    if (provider === "openai") {
      const apiKey = pick("openai.apiKey", "OPENAI_API_KEY");
      if (!apiKey) {
        return { error: "Set myAgent.openai.apiKey, OPENAI_API_KEY in .env, or in the environment." };
      }
      const model = pick("openai.model", "OPENAI_MODEL") || "gpt-5";
      const baseUrl = pick("openai.baseUrl", "OPENAI_BASE_URL");
      const reasoningEffort = pick("openai.reasoningEffort", "OPENAI_REASONING_EFFORT");
      const validEffort = ["", "low", "medium", "high"].includes(reasoningEffort)
        ? (reasoningEffort as "" | "low" | "medium" | "high")
        : "";
      return {
        provider: "openai",
        openai: { apiKey, model, baseUrl: baseUrl || undefined, reasoningEffort: validEffort },
      };
    }

    if (provider === "anthropic") {
      const apiKey = pick("anthropicApiKey", "ANTHROPIC_API_KEY");
      if (!apiKey) {
        return { error: "Set myAgent.anthropicApiKey, ANTHROPIC_API_KEY in .env, or in the environment." };
      }
      const model = pick("model", "MY_AGENT_MODEL") || "claude-opus-4-7";
      return { provider: "anthropic", anthropic: { apiKey, model } };
    }

    return { error: `Unknown provider "${provider}" — expected openai or anthropic.` };
  }

  private getHtml(webview: vscode.Webview): string {
    const distDir = vscode.Uri.joinPath(this.ctx.extensionUri, "dist", "webview");
    const indexHtmlPath = path.join(distDir.fsPath, "index.html");
    if (!fs.existsSync(indexHtmlPath)) {
      return `<!doctype html><html><body><p>Webview not built. Run <code>npm run build:webview</code>.</p></body></html>`;
    }
    let html = fs.readFileSync(indexHtmlPath, "utf8");
    // Rewrite asset paths to webview URIs
    html = html.replace(/(href|src)="\/?([^"]+)"/g, (_, attr, p) => {
      const uri = webview.asWebviewUri(vscode.Uri.joinPath(distDir, p));
      return `${attr}="${uri}"`;
    });
    // Substitute the CSP source placeholder with the real allowed origin
    html = html.replaceAll("__CSP_SOURCE__", webview.cspSource);
    return html;
  }
}
