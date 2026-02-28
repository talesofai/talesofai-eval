import type { Apis, CharacterFromSelect } from "@agent-eval/apis";
import type { CharacterAssign } from "@agent-eval/apis/types";
import type { Logger } from "pino";
import type { AgentEvalCase } from "../types.ts";

// 支持 {@character}, {@character_0}, {@character1}, {@character_1} 格式
const CHARACTER_PLACEHOLDER_REGEX = /\{@character(?:_?(\d+))?\}/g;

/** 获取带 namespace 的 child logger */
const getLogger = (logger: Logger | undefined): Logger | undefined => {
  if (!logger) return undefined;
  return logger.child({ component: "CharacterInjection" });
};

export const mapToCharacterAssign = (
  char: CharacterFromSelect,
): CharacterAssign => ({
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

/**
 * 遍历 input 中的所有文本节点
 * 不创建拷贝，仅用于统计
 */
const walkInputTexts = (
  input: AgentEvalCase["input"],
  visitor: (text: string) => void,
): void => {
  // 处理 parameters
  for (const key of Object.keys(input.parameters)) {
    const val = input.parameters[key];
    if (typeof val === "string") {
      visitor(val);
    }
  }

  // 处理 messages
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

/**
 * 替换 input 中的所有文本节点
 * 创建深拷贝并应用替换
 */
const replaceInputTexts = (
  input: AgentEvalCase["input"],
  replacer: (text: string) => string,
): AgentEvalCase["input"] => {
  const cloned = structuredClone(input);

  // 处理 parameters
  for (const key of Object.keys(cloned.parameters)) {
    const val = cloned.parameters[key];
    if (typeof val === "string") {
      cloned.parameters[key] = replacer(val);
    }
  }

  // 处理 messages
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

/**
 * 从 input 中提取需要的角色数量
 * 规则：
 * - {@character} 表示需要 1 个角色（索引 0）
 * - {@character_N} 或 {@characterN} 表示需要 N+1 个角色（索引 N）
 * - 返回所需的最大角色数量
 */
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

  // 检测不支持的占位符格式（有 {@character 但不匹配正则）
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

  // 防御：限制最大角色数
  const MAX_CHARACTERS = 10;
  if (total > MAX_CHARACTERS) {
    throw new Error(
      `Character injection requested ${total} characters (max ${MAX_CHARACTERS}). ` +
        `Please reduce the number of {@character_N} placeholders.`,
    );
  }

  return total;
};

/**
 * 注入角色到 manuscript assigns 并替换 input 中的占位符
 * 返回一个新的 evalCase（包含替换后的 input）
 */
export const injectAndReplaceCharacters = async (
  evalCase: AgentEvalCase,
  manuscriptUUID: string,
  apis: Apis,
  logger?: Logger,
): Promise<AgentEvalCase> => {
  const log = getLogger(logger);
  const requestedCount = extractCharacterCount(evalCase.input, logger);

  log?.debug(
    { caseId: evalCase.id, manuscriptUUID, count: requestedCount },
    "Required characters",
  );

  if (requestedCount <= 0) return evalCase;

  // 拉取随机角色
  const randomChars = await apis.character.getRandomCharacters(requestedCount);

  log?.debug({ count: randomChars.length }, "API returned characters");
  for (const char of randomChars) {
    log?.debug({ name: char.name, uuid: char.uuid }, "  - Character");
  }

  // 防御：如果 API 返回不足，发出警告
  if (randomChars.length < requestedCount) {
    log?.warn(
      {
        requested: requestedCount,
        received: randomChars.length,
      },
      "API returned fewer characters than requested",
    );
  }

  const characters = randomChars.map(mapToCharacterAssign);

  // 写入 manuscript assigns
  // 基于请求的数量决定 key 命名，保持一致性
  for (let i = 0; i < characters.length; i++) {
    const key = requestedCount === 1 ? "character" : `character_${i}`;
    const char = characters[i];
    if (!char) continue;
    await apis.manuscript.updateManuscriptAssign(manuscriptUUID, key, char);
    log?.debug({ key, name: char.name }, "Written assign");
  }

  // 替换占位符并返回新的 evalCase
  const newInput = replaceInputTexts(evalCase.input, (text) => {
    return text.replace(CHARACTER_PLACEHOLDER_REGEX, (match, indexStr) => {
      const idx = indexStr === undefined ? 0 : parseInt(indexStr, 10);
      const char = characters[idx];
      const result = char ? char.name : match;
      if (char) {
        log?.debug(
          { placeholder: match, name: result },
          "Replaced placeholder",
        );
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
