export type SecretProvider = "anthropic" | "openai";

export function secretKeyFor(key: SecretProvider | "loom.anthropicApiKey" | "loom.openai.apiKey"): string {
  switch (key) {
    case "anthropic":
    case "loom.anthropicApiKey":
      return "loom.secret.anthropicApiKey";
    case "openai":
    case "loom.openai.apiKey":
      return "loom.secret.openaiApiKey";
  }
}
