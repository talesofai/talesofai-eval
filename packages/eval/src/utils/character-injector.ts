import type { Logger } from "pino";
import type {
  AgentEvalCase,
  CharacterFromSelect,
  CharacterProvider,
} from "../types.ts";

// 支持 {@character}, {@character_0}, {@character1}, {@character_1} 格式
const CHARACTER_PLACEHOLDER_REGEX = /\{@character(?:_?(\d+))?\}/g;

const getLogger = (logger: Logger | undefined): Logger | undefined => {
  if (!logger) return undefined;
  return logger.child({ component: "CharacterInjection" });
};

export const mapToCharacterAssign = (char: CharacterFromSelect) => ({
  type: "character",
  uuid: char.uuid,
  name: char.name,
  age: char.biography?.age ?? null,
  interests: char.biography?.interests ?? null,
  persona: char.biography?.persona ?? null,
  description: char.biography?.description ?? null,
  occupation: char.biography?.occupation ?? null,
  avatar_img: char.config?.avatar_img ?? null,
});

const walkInputTexts = (
  input: AgentEvalCase["input"],
  visitor: (text: string) => void,
): void => {
  if (typeof input.system_prompt === "string") {
    visitor(input.system_prompt);
  }

  for (const key of Object.keys(input.parameters)) {
    const val = input.parameters[key];
    if (typeof val === "string") {
      visitor(val);
    }
  }

  for (const msg of input.messages) {
    if (typeof msg.content === "string") {
      visitor(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (
          (part.type === "text" ||
            part.type === "input_text" ||
            part.type === "output_text") &&
          "text" in part &&
          typeof part.text === "string"
        ) {
          visitor(part.text);
        }
      }
    }
  }
};

const replaceInputTexts = (
  input: AgentEvalCase["input"],
  replacer: (text: string) => string,
): AgentEvalCase["input"] => {
  const cloned = structuredClone(input);

  if (typeof cloned.system_prompt === "string") {
    cloned.system_prompt = replacer(cloned.system_prompt);
  }

  for (const key of Object.keys(cloned.parameters)) {
    const val = cloned.parameters[key];
    if (typeof val === "string") {
      cloned.parameters[key] = replacer(val);
    }
  }

  for (const msg of cloned.messages) {
    if (typeof msg.content === "string") {
      msg.content = replacer(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (
          (part.type === "text" ||
            part.type === "input_text" ||
            part.type === "output_text") &&
          "text" in part &&
          typeof part.text === "string"
        ) {
          part.text = replacer(part.text);
        }
      }
    }
  }

  return cloned;
};

export const extractCharacterCount = (
  input: AgentEvalCase["input"],
  logger?: Logger,
): number => {
  let maxIndex = -1;
  let hasPlainCharacter = false;
  let placeholderFound = false;

  walkInputTexts(input, (text) => {
    const matches = text.matchAll(CHARACTER_PLACEHOLDER_REGEX);
    for (const match of matches) {
      placeholderFound = true;
      if (match[1] === undefined) {
        hasPlainCharacter = true;
      } else {
        maxIndex = Math.max(maxIndex, parseInt(match[1], 10));
      }
    }
  });

  if (!placeholderFound) {
    walkInputTexts(input, (text) => {
      if (
        text.includes("{@character") &&
        !text.match(CHARACTER_PLACEHOLDER_REGEX)
      ) {
        logger?.warn(
          { text: text.slice(0, 100) },
          "Detected possible unsupported character placeholder format",
        );
      }
    });
  }

  const countFromIndex = maxIndex + 1;
  const countFromPlain = hasPlainCharacter ? 1 : 0;
  const total = Math.max(countFromIndex, countFromPlain);

  const MAX_CHARACTERS = 10;
  if (total > MAX_CHARACTERS) {
    throw new Error(
      `Character injection requested ${total} characters (max ${MAX_CHARACTERS}). ` +
        `Please reduce the number of {@character_N} placeholders.`,
    );
  }

  return total;
};

export const injectAndReplaceCharacters = async (
  evalCase: AgentEvalCase,
  characterProvider?: CharacterProvider,
  logger?: Logger,
): Promise<AgentEvalCase> => {
  const log = getLogger(logger);
  const requestedCount = extractCharacterCount(evalCase.input, logger);

  log?.debug({ caseId: evalCase.id, count: requestedCount }, "Required characters");

  if (requestedCount <= 0) return evalCase;
  if (!characterProvider) {
    throw new Error(
      "characterProvider is required when agent input contains {@character} placeholders",
    );
  }

  const randomChars = await characterProvider.getRandomCharacters(requestedCount);
  const characters = randomChars.map(mapToCharacterAssign);

  if (randomChars.length < requestedCount) {
    log?.warn(
      {
        requested: requestedCount,
        received: randomChars.length,
      },
      "Character provider returned fewer characters than requested",
    );
  }

  const newInput = replaceInputTexts(evalCase.input, (text) => {
    return text.replace(CHARACTER_PLACEHOLDER_REGEX, (match, indexStr) => {
      const idx = indexStr === undefined ? 0 : parseInt(indexStr, 10);
      const char = characters[idx];
      const result = char ? char.name : match;
      if (char) {
        log?.debug({ placeholder: match, name: result }, "Replaced placeholder");
      } else {
        log?.warn(
          { placeholder: match, index: idx },
          "Character not found, keeping placeholder",
        );
      }
      return result;
    });
  });

  return { ...evalCase, input: newInput };
};
