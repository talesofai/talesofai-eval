export interface StreamOptions {
  temperature?: number;
  maxTokens?: number;
  /** Override API key from ModelConfig.apiKey */
  apiKey?: string;
  /** Additional headers to merge with ModelConfig.headers */
  headers?: Record<string, string>;
}
