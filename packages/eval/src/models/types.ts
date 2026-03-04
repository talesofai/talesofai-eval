export interface ModelConfig {
  id: string;
  name: string;
  api: "openai-completions" | "anthropic-messages" | string;
  provider: string;
  baseUrl: string;
  apiKey?: string;
  reasoning?: boolean;
  input?: ("text" | "image")[];
  cost?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  contextWindow?: number;
  maxTokens?: number;
  headers?: Record<string, string>;
}

export interface ModelRegistry {
  $schema?: string;
  models: Record<string, ModelConfig>;
}
