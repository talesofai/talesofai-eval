import type {
  AgentEvalCase,
  CharacterFromSelect,
  CharacterProvider,
  EvalTrace,
  RunnerOptions,
} from "../types.ts";
import { DEFAULT_UPSTREAM_API_BASE_URL } from "../constants.ts";
import { injectAndReplaceCharacters } from "../utils/character-injector.ts";
import { normalizeAgentInput } from "./normalize-agent-input.ts";
import { runPlain } from "./plain.ts";

const resolveUpstreamApiBaseURL = (): string => {
  const value = process.env["EVAL_UPSTREAM_API_BASE_URL"];
  if (value && value.trim().length > 0) {
    return value;
  }
  return DEFAULT_UPSTREAM_API_BASE_URL;
};

const createDefaultCharacterProvider = (): CharacterProvider => ({
  getRandomCharacters: async (count: number): Promise<CharacterFromSelect[]> => {
    const baseURL = resolveUpstreamApiBaseURL();
    const url = new URL(
      `/v1/collection-interactive/char_roll?num=${count}`,
      baseURL,
    );

    const upstreamToken = process.env["EVAL_UPSTREAM_X_TOKEN"];
    const headers: Record<string, string> = upstreamToken
      ? { "x-token": upstreamToken }
      : {};

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(
        `getRandomCharacters failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error("getRandomCharacters failed: invalid response shape");
    }
    return data as CharacterFromSelect[];
  },
});

export const runAgent = async (
  evalCase: AgentEvalCase,
  opts: RunnerOptions,
): Promise<EvalTrace> => {
  const characterProvider = opts.characterProvider ?? createDefaultCharacterProvider();
  const injectedCase = await injectAndReplaceCharacters(
    evalCase,
    characterProvider,
    opts.logger,
  );
  const normalizedCase = normalizeAgentInput(injectedCase);
  return runPlain(normalizedCase, opts);
};
