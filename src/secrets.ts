export type SecretProvider = "anthropic" | "openai" | "openai-compatible";

export function secretKeyFor(
  key: SecretProvider | "loom.anthropicApiKey" | "loom.openai.apiKey" | "loom.openaiCompatible.apiKey",
): string {
  switch (key) {
    case "anthropic":
    case "loom.anthropicApiKey":
      return "loom.secret.anthropicApiKey";
    case "openai":
    case "loom.openai.apiKey":
      return "loom.secret.openaiApiKey";
    case "openai-compatible":
    case "loom.openaiCompatible.apiKey":
      return "loom.secret.openaiCompatibleApiKey";
  }
}
