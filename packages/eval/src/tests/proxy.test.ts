import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  createManuscriptProxy,
  type ManuscriptProxy,
} from "../runners/manuscript-proxy.ts";

const TEST_PORT = 19876;

describe("ManuscriptProxy", () => {
  let proxy: ManuscriptProxy;

  before(async () => {
    proxy = createManuscriptProxy({
      port: TEST_PORT,
      allowedToolNames: ["make_image", "update_assign"],
    });
    await proxy.start();
  });

  after(async () => {
    await proxy.stop();
  });

  it("creates and reads a manuscript via POST + GET", async () => {
    const createRes = await fetch(
      `http://127.0.0.1:${TEST_PORT}/v1/manuscript`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entrance_type: "VERSE" }),
      },
    );
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as { uuid: string };
    assert.ok(created.uuid);

    const getRes = await fetch(
      `http://127.0.0.1:${TEST_PORT}/v1/manuscript/${created.uuid}`,
    );
    assert.equal(getRes.status, 200);
    const data = (await getRes.json()) as { uuid: string; status: string };
    assert.equal(data.uuid, created.uuid);
    assert.equal(data.status, "NORMAL");
  });

  it("seeds a manuscript and reads it", async () => {
    const uuid = crypto.randomUUID();
    proxy.seed(uuid);

    const res = await fetch(
      `http://127.0.0.1:${TEST_PORT}/v1/manuscript/${uuid}`,
    );
    assert.equal(res.status, 200);
    const data = (await res.json()) as { uuid: string };
    assert.equal(data.uuid, uuid);
  });

  it("returns 404 for unknown manuscript", async () => {
    const res = await fetch(
      `http://127.0.0.1:${TEST_PORT}/v1/manuscript/${crypto.randomUUID()}`,
    );
    assert.equal(res.status, 404);
  });

  it("patches manuscript running_status", async () => {
    const uuid = crypto.randomUUID();
    proxy.seed(uuid);

    const patchRes = await fetch(
      `http://127.0.0.1:${TEST_PORT}/v1/manuscript/${uuid}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ running_status: "PROCESSING" }),
      },
    );
    assert.equal(patchRes.status, 200);
    const patched = (await patchRes.json()) as {
      running_status: string;
    };
    assert.equal(patched.running_status, "PROCESSING");
  });

  it("manages assigns (PUT, GET, LIST, DELETE)", async () => {
    const uuid = crypto.randomUUID();
    proxy.seed(uuid);

    // PUT
    const putRes = await fetch(
      `http://127.0.0.1:${TEST_PORT}/v1/manuscript/${uuid}/assigns/test_key`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: "hello" }),
      },
    );
    assert.equal(putRes.status, 200);
    const putData = (await putRes.json()) as {
      assign_key: string;
      data: string;
    };
    assert.equal(putData.assign_key, "test_key");
    assert.equal(putData.data, "hello");

    // GET
    const getRes = await fetch(
      `http://127.0.0.1:${TEST_PORT}/v1/manuscript/${uuid}/assigns/test_key`,
    );
    assert.equal(getRes.status, 200);
    const getData = (await getRes.json()) as { data: string };
    assert.equal(getData.data, "hello");

    // LIST
    const listRes = await fetch(
      `http://127.0.0.1:${TEST_PORT}/v1/manuscript/${uuid}/assigns`,
    );
    assert.equal(listRes.status, 200);
    const listData = (await listRes.json()) as {
      assigns: Record<string, unknown>;
    };
    assert.ok("test_key" in listData.assigns);

    // DELETE
    const delRes = await fetch(
      `http://127.0.0.1:${TEST_PORT}/v1/manuscript/${uuid}/assigns/test_key`,
      { method: "DELETE" },
    );
    assert.equal(delRes.status, 204);

    // Verify deleted
    const afterDel = await fetch(
      `http://127.0.0.1:${TEST_PORT}/v1/manuscript/${uuid}/assigns/test_key`,
    );
    assert.equal(afterDel.status, 404);
  });

  it("manages assets (POST, GET list, GET single, DELETE)", async () => {
    const uuid = crypto.randomUUID();
    proxy.seed(uuid);

    // POST
    const postRes = await fetch(
      `http://127.0.0.1:${TEST_PORT}/v1/manuscript/${uuid}/assets`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task_uuid: "t1",
          artifact_uuid: "a1",
          assign_key: "k1",
        }),
      },
    );
    assert.equal(postRes.status, 201);
    const asset = (await postRes.json()) as { artifact_uuid: string };
    assert.equal(asset.artifact_uuid, "a1");

    // GET list
    const listRes = await fetch(
      `http://127.0.0.1:${TEST_PORT}/v1/manuscript/${uuid}/assets`,
    );
    assert.equal(listRes.status, 200);
    const list = (await listRes.json()) as { artifact_uuid: string }[];
    assert.equal(list.length, 1);

    // GET single
    const getRes = await fetch(
      `http://127.0.0.1:${TEST_PORT}/v1/manuscript/${uuid}/assets/a1`,
    );
    assert.equal(getRes.status, 200);

    // DELETE
    const delRes = await fetch(
      `http://127.0.0.1:${TEST_PORT}/v1/manuscript/${uuid}/assets/a1`,
      { method: "DELETE" },
    );
    assert.equal(delRes.status, 204);

    // Verify empty
    const afterDel = await fetch(
      `http://127.0.0.1:${TEST_PORT}/v1/manuscript/${uuid}/assets`,
    );
    const afterList = (await afterDel.json()) as unknown[];
    assert.equal(afterList.length, 0);
  });

  it("returns versePreset stub with configured tool names", async () => {
    const res = await fetch(
      `http://127.0.0.1:${TEST_PORT}/v1/verse/preset/${crypto.randomUUID()}`,
    );
    assert.equal(res.status, 200);
    const data = (await res.json()) as { toolset_keys: string[] };
    assert.deepEqual(data.toolset_keys, ["make_image", "update_assign"]);
  });

  it("clears a manuscript", async () => {
    const uuid = crypto.randomUUID();
    proxy.seed(uuid);
    proxy.clear(uuid);

    const res = await fetch(
      `http://127.0.0.1:${TEST_PORT}/v1/manuscript/${uuid}`,
    );
    assert.equal(res.status, 404);
  });

  it("deletes a manuscript via DELETE", async () => {
    const uuid = crypto.randomUUID();
    proxy.seed(uuid);

    const delRes = await fetch(
      `http://127.0.0.1:${TEST_PORT}/v1/manuscript/${uuid}`,
      { method: "DELETE" },
    );
    assert.equal(delRes.status, 204);

    const getRes = await fetch(
      `http://127.0.0.1:${TEST_PORT}/v1/manuscript/${uuid}`,
    );
    assert.equal(getRes.status, 404);
  });
});
