import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createManuscriptModel } from "../../../apis/src/manuscript.ts";

describe("createManuscriptModel asset helpers", () => {
  it("uses manuscript uuid for asset API calls", async () => {
    const manuscriptUuid = "manuscript-1";
    const capturedGet: string[][] = [];
    const capturedDelete: string[][] = [];

    const apis = {
      manuscript: {
        getManuscript: async () => ({
          uuid: manuscriptUuid,
          entrance_type: "VERSE" as const,
          ctime: "now",
          mtime: "now",
          status: "NORMAL" as const,
        }),
        getManuscriptAsset: async (uuid: string, assetUuid: string) => {
          capturedGet.push([uuid, assetUuid]);
          return {
            task_uuid: "task-1",
            artifact_uuid: assetUuid,
            assign_key: "assign",
            toolcall_uuid: null,
            ctime: "now",
            is_import: false as const,
            artifact: {
              uuid: assetUuid,
              url: "https://example.com/a.png",
              modality: "IMAGE" as const,
              status: "SUCCESS" as const,
            },
          };
        },
        deleteManuscriptAsset: async (uuid: string, assetUuid: string) => {
          capturedDelete.push([uuid, assetUuid]);
        },
        listManuscriptAssets: async () => [],
        addManuscriptAsset: async (uuid: string, payload: unknown) => {
          assert.equal(uuid, manuscriptUuid);
          return payload;
        },
        listManuscriptAssigns: async () => ({ assigns: {} }),
        getManuscriptAssign: async () => ({
          assign_key: "assign",
          data: "",
          ctime: "now",
          mtime: "now",
        }),
        deleteManuscriptAssign: async () => {},
        updateManuscriptAssign: async () => ({
          assign_key: "assign",
          data: "",
          ctime: "now",
          mtime: "now",
        }),
        updateManuscript: async () => ({
          uuid: manuscriptUuid,
          entrance_type: "VERSE" as const,
          ctime: "now",
          mtime: "now",
          status: "NORMAL" as const,
        }),
      },
      verse: {
        versePreset: async () => null,
      },
    };

    const model = await createManuscriptModel(manuscriptUuid, apis as never);
    await model.getAsset("asset-1");
    await model.deleteAsset("asset-2");

    assert.deepEqual(capturedGet, [[manuscriptUuid, "asset-1"]]);
    assert.deepEqual(capturedDelete, [[manuscriptUuid, "asset-2"]]);
  });
});
