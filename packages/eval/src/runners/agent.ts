import {
  resolveUpstreamBaseURL,
  resolveUpstreamXToken,
} from "../env.ts";
import type {
  AgentEvalCase,
  CharacterFromSelect,
  CharacterProvider,
  EvalTrace,
  RunnerOptions,
} from "../types.ts";
import { injectAndReplaceCharacters } from "../utils/character-injector.ts";
import { normalizeAgentInput } from "./normalize-agent-input.ts";
import { runPlain } from "./plain.ts";

const createDefaultCharacterProvider = (): CharacterProvider => ({
  getRandomCharacters: async (count: number): Promise<CharacterFromSelect[]> => {
    const baseURL = resolveUpstreamBaseURL();
    const url = new URL(
      `/v1/collection-interactive/char_roll?num=${count}`,
      baseURL,
    );

    const upstreamToken = resolveUpstreamXToken();
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
