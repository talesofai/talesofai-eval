import { safeParseJson } from "./utils/safe-parse-json.ts";
import axios, { AxiosError } from "axios";
import { createActivityApis, type SelectedCollection } from "./activity.ts";
import { createArtifactApis } from "./artifact.ts";
import { createAudioApis } from "./audio.ts";
import { createCharacterApis } from "./character.ts";
import { createConfigApis } from "./config.ts";
import { createGptApis } from "./gpt.ts";
import {
  createHashtagApis,
  type HashtagInfo,
  type LoreEntry,
} from "./hashtag.ts";
import {
  createManuscriptApis,
  createManuscriptModel,
  type ManuscriptModel,
} from "./manuscript.ts";
import { createPromptApis } from "./prompt.ts";
import { createTaskApis } from "./task.ts";
import { createTcpApis } from "./tcp.ts";
import type { PromiseResult } from "./types.ts";
import { createVerseApis } from "./verse.ts";

export class ApiResponseError extends Error {
  public readonly code: number;
  public readonly message: string;

  constructor(
    code: number,
    message: string,
    options?: {
      cause?: unknown;
    },
  ) {
    super(message, {
      ...options,
    });
    this.code = code;
    this.message = message;
    this.name = "ApiResponseError";
  }
}

export const catchErrorResponse = (data?: unknown): string => {
  if (typeof data !== "string" && typeof data !== "object") return String(data);
  const parsedData: {
    message?: string;
    msg?: string;
    detail?:
      | string
      | {
          message?: string;
          msg?: string;
        }
      // * for code = 422
      | [{ msg: string }];
  } | null = typeof data === "string" ? (safeParseJson(data) ?? {}) : data;

  const detail = parsedData?.["detail"];
  if (typeof detail === "string") {
    return detail;
  }

  if (typeof detail === "object") {
    if (Array.isArray(detail)) {
      return detail.map(({ msg } = { msg: "" }) => msg).join(", ");
    } else {
      return detail["message"] ?? detail["msg"] ?? JSON.stringify(detail);
    }
  }

  const message =
    parsedData?.["message"] ??
    parsedData?.["msg"] ??
    JSON.stringify(parsedData);
  return message;
};

const handleAxiosError = (error: unknown) => {
  if (error instanceof AxiosError) {
    if (error.response?.status) {
      let message = error.message;
      if (error.response.status >= 400 && error.response.status < 500) {
        message = catchErrorResponse(error.response.data);
      }

      throw new ApiResponseError(error.response.status, message, {
        cause: error,
      });
    }
  }

  if (error instanceof Error) {
    throw new ApiResponseError(-1, error.message, {
      cause: error,
    });
  }

  if (typeof error === "object" && error !== null) {
    throw new ApiResponseError(-1, JSON.stringify(error), {
      cause: error,
    });
  }

  throw new ApiResponseError(-1, String(error), {
    cause: error,
  });
};

export const createApis = (option: {
  headers: Record<string, string | string[] | undefined>;
  baseUrl: string;
}) => {
  const baseUrl = option.baseUrl;
  const client = axios.create({
    adapter: "fetch",
    baseURL: baseUrl,
    headers: {
      ...option.headers,
    },
  });

  client.interceptors.response.use(
    (response) => response,
    (error) => {
      handleAxiosError(error);
    },
  );

  const tcp = createTcpApis(client);
  const prompt = createPromptApis(client, tcp);
  const artifact = createArtifactApis(client);
  const manuscript = createManuscriptApis(client);
  const gpt = createGptApis(client);
  const audio = createAudioApis(client);
  const hashtag = createHashtagApis(client);
  const activity = createActivityApis(client);
  const verse = createVerseApis(client);
  const task = createTaskApis(client);
  const config = createConfigApis(client);
  const character = createCharacterApis(client);

  return {
    tcp,
    prompt,
    artifact,
    manuscript,
    gpt,
    audio,
    hashtag,
    activity,
    verse,
    task,
    config,
    character,
  };
};

export type Apis = PromiseResult<ReturnType<typeof createApis>>;

export type { ManuscriptModel };
export { createManuscriptModel };
export type { HashtagInfo };
export type { LoreEntry };
export type { SelectedCollection };
export type { CharacterFromSelect } from "./character.ts";
export { mapToCharacterAssign } from "./character.ts";
