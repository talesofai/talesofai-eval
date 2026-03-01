import type { AxiosInstance } from "axios";
import type { Apis } from "./index.ts";
import type {
  Assign,
  Manuscript,
  ManuscriptAsset,
  ManuscriptAssetCreatePayload,
  ManuscriptCreatePayload,
  ManuscriptRunningStatus,
} from "./types.ts";
import type { VersePreset } from "./verse.ts";

export const createManuscriptApis = (client: AxiosInstance) => {
  const createManuscript = async (payload: ManuscriptCreatePayload) =>
    client.post<Manuscript>("/v1/manuscript", payload).then((res) => res.data);

  const getManuscript = async (uuid: string) =>
    client.get<Manuscript>(`/v1/manuscript/${uuid}`).then((res) => res.data);

  const updateManuscript = async (
    uuid: string,
    payload: {
      running_status?: ManuscriptRunningStatus;
      conversation_uuid?: string;
    },
  ) =>
    client
      .patch<Manuscript>(`/v1/manuscript/${uuid}`, payload)
      .then((res) => res.data);

  const deleteManuscript = async (uuid: string) =>
    client.delete<void>(`/v1/manuscript/${uuid}`);

  //

  const addManuscriptAsset = async (
    uuid: string,
    payload: ManuscriptAssetCreatePayload,
  ) =>
    client
      .post<ManuscriptAsset>(`/v1/manuscript/${uuid}/assets`, payload)
      .then((res) => res.data);

  const getManuscriptAsset = async (uuid: string, artifact_uuid: string) =>
    client
      .get<ManuscriptAsset>(`/v1/manuscript/${uuid}/assets/${artifact_uuid}`)
      .then((res) => res.data);

  const listManuscriptAssets = async (uuid: string) =>
    client
      .get<ManuscriptAsset[]>(`/v1/manuscript/${uuid}/assets`)
      .then((res) => res.data);

  const deleteManuscriptAsset = async (uuid: string, artifact_uuid: string) =>
    client
      .delete<void>(`/v1/manuscript/${uuid}/assets/${artifact_uuid}`)
      .then((res) => res.data);

  //

  const listManuscriptAssigns = async (uuid: string, with_hidden?: boolean) =>
    client
      .get<{
        assigns: Record<string, Assign>;
      }>(`/v1/manuscript/${uuid}/assigns`, {
        params: {
          with_hidden,
        },
      })
      .then((res) => res.data);

  const getManuscriptAssign = async (
    uuid: string,
    key: string,
    with_hidden?: boolean,
  ) =>
    client
      .get<{
        assign_key: string;
        data: Assign;
        ctime: string;
        mtime: string;
      }>(`/v1/manuscript/${uuid}/assigns/${key}`, {
        params: {
          with_hidden,
        },
      })
      .then((res) => res.data);

  const updateManuscriptAssign = async (
    uuid: string,
    key: string,
    payload: Assign,
  ) =>
    client
      .put<{
        assign_key: string;
        data: Assign;
        ctime: string;
        mtime: string;
      }>(`/v1/manuscript/${uuid}/assigns/${key}`, {
        data: payload,
      })
      .then((res) => res.data);

  const deleteManuscriptAssign = async (uuid: string, key: string) =>
    client
      .delete<void>(`/v1/manuscript/${uuid}/assigns/${key}`)
      .then((res) => res.data);

  return {
    createManuscript,
    getManuscript,
    updateManuscript,
    deleteManuscript,
    addManuscriptAsset,
    getManuscriptAsset,
    listManuscriptAssets,
    deleteManuscriptAsset,
    listManuscriptAssigns,
    getManuscriptAssign,
    updateManuscriptAssign,
    deleteManuscriptAssign,
  };
};

export interface ManuscriptModel {
  uuid: string;
  versePreset: VersePreset | null;
  read(): Promise<Manuscript | null>;
  update(payload: {
    running_status?: ManuscriptRunningStatus;
    conversation_uuid?: string;
    verse_preset_uuid?: string;
  }): Promise<Manuscript>;

  listAssets(): Promise<ManuscriptAsset[]>;
  getAsset(uuid: string): Promise<ManuscriptAsset | null>;
  addAsset(asset: ManuscriptAsset): Promise<ManuscriptAsset>;
  deleteAsset(uuid: string): Promise<void>;

  listAssigns(with_hidden?: boolean): Promise<Record<string, Assign>>;
  getAssign(key: string, with_hidden?: boolean): Promise<Assign>;
  deleteAssign(key: string): Promise<void>;
  putAssign(key: string, assign: Assign): Promise<Assign>;

  /**
   * Inject assign values into a prompt template.
   */
  injectAssigns(
    prompt: string,
    mapper: (assign: Assign, raw: string) => string,
    assigns: Record<string, Assign>,
  ): Promise<string>;

  matchAssign(
    input: string,
    assigns: Record<string, Assign>,
  ): Promise<Assign | null>;
}

export const createManuscriptModel = async (uuid: string, apis: Apis) => {
  const listAssigns = async () => {
    const res = await apis.manuscript.listManuscriptAssigns(uuid);
    return res.assigns;
  };

  const getAssign = async (key: string, with_hidden?: boolean) => {
    const res = await apis.manuscript.getManuscriptAssign(
      uuid,
      key,
      with_hidden,
    );
    return res.data;
  };

  const deleteAssign = async (key: string) => {
    await apis.manuscript.deleteManuscriptAssign(uuid, key);
  };

  const putAssign = async (key: string, assign: Assign) => {
    const res = await apis.manuscript.updateManuscriptAssign(uuid, key, assign);
    return res.data;
  };

  const injectAssigns = async (
    prompt: string,
    mapper: (assign: Assign, raw: string) => string,
    assigns: Record<string, Assign>,
  ) => {
    return _injectAssigns(prompt, assigns, mapper);
  };

  const matchAssign = async (
    input: string,
    assigns: Record<string, Assign>,
  ) => {
    return _matchAssign(input, assigns);
  };

  const data = await apis.manuscript.getManuscript(uuid).catch(() => null);
  const versePreset = data?.verse_preset_uuid
    ? await apis.verse.versePreset(data?.verse_preset_uuid).catch(() => null)
    : null;

  return {
    uuid,
    data,
    versePreset,
    read: () => apis.manuscript.getManuscript(uuid),
    update: (payload: {
      running_status?: ManuscriptRunningStatus;
      conversation_uuid?: string;
    }) => apis.manuscript.updateManuscript(uuid, payload),
    listAssets: () => apis.manuscript.listManuscriptAssets(uuid),
    getAsset: (assetUuid: string) =>
      apis.manuscript.getManuscriptAsset(uuid, assetUuid),
    addAsset: (asset: ManuscriptAsset) =>
      apis.manuscript.addManuscriptAsset(uuid, asset),
    deleteAsset: (assetUuid: string) =>
      apis.manuscript.deleteManuscriptAsset(uuid, assetUuid),
    listAssigns,
    getAssign,
    deleteAssign,
    putAssign,
    injectAssigns,
    matchAssign,
  };
};

// JavaScript variable placeholder pattern with broad Unicode support.
// First character: $, _, or a Unicode letter.
// Following characters: first-character set plus digits.
const VARIABLE_NAME_PATTERN =
  /{([$_\u4e00-\u9fa5a-zA-Z\u00A0-\uFFFF][$_\u4e00-\u9fa5a-zA-Z0-9\u00A0-\uFFFF]*)}/g;

const _injectAssigns = (
  input: string,
  assigns: Record<string, Assign>,
  mapper: (assign: Assign, raw: string) => string,
) => {
  const matches = input.match(VARIABLE_NAME_PATTERN);
  if (!matches) {
    return input;
  }

  return matches.reduce((acc, match) => {
    const assign = assigns[match.replace("{", "").replace("}", "")];
    if (!assign) {
      return acc;
    }
    return acc.replace(match, mapper(assign, match));
  }, input);
};

const _matchAssign = (input: string, assigns: Record<string, Assign>) => {
  const matches = input.match(VARIABLE_NAME_PATTERN);
  if (!matches) {
    return null;
  }

  const matched = matches[0];
  if (!matched) {
    return null;
  }
  const assign = assigns[matched.replace("{", "").replace("}", "")];
  if (!assign) {
    return null;
  }
  return assign;
};
