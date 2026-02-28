import type { Server } from "node:http";
import type {
  Assign,
  Manuscript,
  ManuscriptAsset,
  ManuscriptAssetArtifact,
  ManuscriptRunningStatus,
} from "@agent-eval/apis/types";
import axios from "axios";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";

// ─── In-memory store ─────────────────────────────────────────────────────────

type StoredManuscript = Manuscript & {
  assigns: Map<string, { data: Assign; ctime: string; mtime: string }>;
  assets: ManuscriptAsset[];
};

const createStore = () => {
  const manuscripts = new Map<string, StoredManuscript>();

  const seed = (
    uuid: string,
    opts?: { verse_preset_uuid?: string },
  ): StoredManuscript => {
    const now = new Date().toISOString();
    const m: StoredManuscript = {
      uuid,
      entrance_type: "VERSE",
      ctime: now,
      mtime: now,
      status: "NORMAL",
      running_status: null,
      verse_preset_uuid: opts?.verse_preset_uuid ?? null,
      assigns: new Map(),
      assets: [],
    };
    manuscripts.set(uuid, m);
    return m;
  };

  return { manuscripts, seed };
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const toManuscriptResponse = (m: StoredManuscript): Manuscript => ({
  uuid: m.uuid,
  entrance_type: m.entrance_type,
  ctime: m.ctime,
  mtime: m.mtime,
  status: m.status,
  running_status: m.running_status,
  verse_preset_uuid: m.verse_preset_uuid,
});

const getParam = (req: Request, name: string): string => {
  const val = req.params[name];
  if (!val) throw new Error(`missing param: ${name}`);
  if (Array.isArray(val)) {
    const first = val[0];
    if (!first) throw new Error(`missing param: ${name}`);
    return first;
  }
  return val;
};

const getUpstreamHeaders = (req: Request, upstreamToken?: string) => {
  const headers: Record<string, string> = {};
  const reqToken = req.headers["x-token"];
  if (typeof reqToken === "string" && reqToken.length > 0) {
    headers["x-token"] = reqToken;
  } else if (upstreamToken) {
    headers["x-token"] = upstreamToken;
  }

  const contentType = req.headers["content-type"];
  if (typeof contentType === "string" && contentType.length > 0) {
    headers["content-type"] = contentType;
  }

  return headers;
};

// ─── Proxy config ────────────────────────────────────────────────────────────

export type ManuscriptProxyOptions = {
  port: number;
  upstreamBaseURL?: string;
  upstreamToken?: string;
  /** Tool names used to construct versePreset stub */
  allowedToolNames?: string[];
};

export type ManuscriptProxy = {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Seed a manuscript so GET/PATCH work without a real POST */
  seed(uuid: string, opts?: { verse_preset_uuid?: string }): void;
  /** Clear a single manuscript from the in-memory store */
  clear(uuid: string): void;
  readonly url: string;
};

export const createManuscriptProxy = (
  options: ManuscriptProxyOptions,
): ManuscriptProxy => {
  const { port, upstreamBaseURL, upstreamToken, allowedToolNames } = options;
  const store = createStore();
  const app = express();
  let server: Server | null = null;

  app.use(express.json({ limit: "10mb" }));

  // ── Manuscript CRUD ────────────────────────────────────────────────────────

  app.post("/v1/manuscript", async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown> | undefined;

    if (upstreamBaseURL) {
      const upstream = await axios({
        method: "post",
        url: `${upstreamBaseURL}/v1/manuscript`,
        headers: getUpstreamHeaders(req, upstreamToken),
        data: body,
        validateStatus: () => true,
      });

      const upstreamData = upstream.data as Manuscript;
      if (upstream.status >= 400 || !upstreamData.uuid) {
        res.status(upstream.status).json(upstream.data);
        return;
      }

      const m = store.seed(upstreamData.uuid, {
        verse_preset_uuid: upstreamData.verse_preset_uuid ?? undefined,
      });
      m.entrance_type = upstreamData.entrance_type;
      m.status = upstreamData.status;
      m.running_status = upstreamData.running_status ?? null;
      m.ctime = upstreamData.ctime;
      m.mtime = upstreamData.mtime;
      m.conversation_uuid = upstreamData.conversation_uuid;
      res.status(upstream.status).json(upstreamData);
      return;
    }

    const uuid = crypto.randomUUID();
    const m = store.seed(uuid, {
      verse_preset_uuid: (body?.["verse_preset_uuid"] as string) ?? undefined,
    });
    res.status(201).json(toManuscriptResponse(m));
  });

  app.get("/v1/manuscript/:uuid", (req: Request, res: Response) => {
    const m = store.manuscripts.get(getParam(req, "uuid"));
    if (!m) {
      res.status(404).json({ message: "not found" });
      return;
    }
    res.json(toManuscriptResponse(m));
  });

  app.patch("/v1/manuscript/:uuid", (req: Request, res: Response) => {
    const m = store.manuscripts.get(getParam(req, "uuid"));
    if (!m) {
      res.status(404).json({ message: "not found" });
      return;
    }
    const body = req.body as Record<string, unknown> | undefined;
    if (body?.["running_status"]) {
      m.running_status = body["running_status"] as ManuscriptRunningStatus;
    }
    if (body?.["conversation_uuid"]) {
      m.conversation_uuid = body["conversation_uuid"] as string;
    }
    m.mtime = new Date().toISOString();
    res.json(toManuscriptResponse(m));
  });

  app.delete("/v1/manuscript/:uuid", async (req: Request, res: Response) => {
    const uuid = getParam(req, "uuid");

    if (upstreamBaseURL) {
      const upstream = await axios({
        method: "delete",
        url: `${upstreamBaseURL}/v1/manuscript/${uuid}`,
        headers: getUpstreamHeaders(req, upstreamToken),
        validateStatus: () => true,
      });

      if (upstream.status >= 400) {
        res.status(upstream.status).json(upstream.data);
        return;
      }
    }

    store.manuscripts.delete(uuid);
    res.status(204).end();
  });

  // ── Assets ─────────────────────────────────────────────────────────────────

  app.post("/v1/manuscript/:uuid/assets", (req: Request, res: Response) => {
    const m = store.manuscripts.get(getParam(req, "uuid"));
    if (!m) {
      res.status(404).json({ message: "not found" });
      return;
    }
    const body = req.body as Record<string, unknown> | undefined;
    const now = new Date().toISOString();
    const asset: ManuscriptAsset = {
      task_uuid: (body?.["task_uuid"] as string) ?? "",
      artifact_uuid: (body?.["artifact_uuid"] as string) ?? crypto.randomUUID(),
      assign_key: (body?.["assign_key"] as string) ?? "",
      toolcall_uuid: (body?.["toolcall_uuid"] as string) ?? null,
      ctime: now,
      is_import: false,
      artifact: (body?.["artifact"] ?? {
        uuid: (body?.["artifact_uuid"] as string) ?? crypto.randomUUID(),
        url: "",
        modality: "IMAGE",
        status: "SUCCESS",
      }) as ManuscriptAssetArtifact,
    };
    m.assets.push(asset);
    res.status(201).json(asset);
  });

  app.get("/v1/manuscript/:uuid/assets", (req: Request, res: Response) => {
    const m = store.manuscripts.get(getParam(req, "uuid"));
    if (!m) {
      res.status(404).json({ message: "not found" });
      return;
    }
    res.json(m.assets);
  });

  app.get(
    "/v1/manuscript/:uuid/assets/:assetId",
    (req: Request, res: Response) => {
      const m = store.manuscripts.get(getParam(req, "uuid"));
      if (!m) {
        res.status(404).json({ message: "not found" });
        return;
      }
      const assetId = getParam(req, "assetId");
      const asset = m.assets.find((a) => a.artifact_uuid === assetId);
      if (!asset) {
        res.status(404).json({ message: "not found" });
        return;
      }
      res.json(asset);
    },
  );

  app.delete(
    "/v1/manuscript/:uuid/assets/:assetId",
    (req: Request, res: Response) => {
      const m = store.manuscripts.get(getParam(req, "uuid"));
      if (!m) {
        res.status(404).json({ message: "not found" });
        return;
      }
      const assetId = getParam(req, "assetId");
      m.assets = m.assets.filter((a) => a.artifact_uuid !== assetId);
      res.status(204).end();
    },
  );

  // ── Assigns ────────────────────────────────────────────────────────────────

  app.get("/v1/manuscript/:uuid/assigns", (req: Request, res: Response) => {
    const m = store.manuscripts.get(getParam(req, "uuid"));
    if (!m) {
      res.status(404).json({ message: "not found" });
      return;
    }
    const assigns: Record<string, Assign> = {};
    for (const [key, val] of m.assigns) {
      if (!key.startsWith("__") || req.query["with_hidden"] === "true") {
        assigns[key] = val.data;
      }
    }
    res.json({ assigns });
  });

  app.get(
    "/v1/manuscript/:uuid/assigns/:key",
    (req: Request, res: Response) => {
      const m = store.manuscripts.get(getParam(req, "uuid"));
      if (!m) {
        res.status(404).json({ message: "not found" });
        return;
      }
      const key = getParam(req, "key");
      const entry = m.assigns.get(key);
      if (!entry) {
        res.status(404).json({ message: "not found" });
        return;
      }
      res.json({
        assign_key: key,
        data: entry.data,
        ctime: entry.ctime,
        mtime: entry.mtime,
      });
    },
  );

  app.put(
    "/v1/manuscript/:uuid/assigns/:key",
    (req: Request, res: Response) => {
      const m = store.manuscripts.get(getParam(req, "uuid"));
      if (!m) {
        res.status(404).json({ message: "not found" });
        return;
      }
      const key = getParam(req, "key");
      const body = req.body as Record<string, unknown> | undefined;
      const now = new Date().toISOString();
      const existing = m.assigns.get(key);
      const entry = {
        data: (body?.["data"] ?? null) as Assign,
        ctime: existing?.ctime ?? now,
        mtime: now,
      };
      m.assigns.set(key, entry);
      res.json({
        assign_key: key,
        data: entry.data,
        ctime: entry.ctime,
        mtime: entry.mtime,
      });
    },
  );

  app.delete(
    "/v1/manuscript/:uuid/assigns/:key",
    (req: Request, res: Response) => {
      const m = store.manuscripts.get(getParam(req, "uuid"));
      if (!m) {
        res.status(404).json({ message: "not found" });
        return;
      }
      const key = getParam(req, "key");
      m.assigns.delete(key);
      res.status(204).end();
    },
  );

  // ── VersePreset stub ───────────────────────────────────────────────────────

  app.get("/v1/verse/preset/:uuid", (req: Request, res: Response) => {
    res.json({
      uuid: getParam(req, "uuid"),
      name: "eval-stub",
      system_root_prompt_key: "",
      toolset_keys: allowedToolNames ?? [],
      tools: "",
      ui_component_key: "",
      interactive_config: {
        button_name: "",
        make_image_aspect: "1:1",
        advanced_translator: false,
      },
      hashtags: [],
      preset_description: "",
      preset_content_schema: "",
      reference_content: "",
      reference_planning: "",
      creator: null,
      status: "PUBLISHED",
    });
  });

  // ── Catch-all: passthrough to upstream ─────────────────────────────────────

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!upstreamBaseURL) {
      res.status(502).json({ message: "no upstream configured" });
      return;
    }

    const url = `${upstreamBaseURL}${req.originalUrl}`;
    const headers = getUpstreamHeaders(req, upstreamToken);

    axios({
      method: req.method as "get" | "post" | "put" | "patch" | "delete",
      url,
      headers,
      data: req.body,
      validateStatus: () => true,
      responseType: "arraybuffer",
    })
      .then((upstream) => {
        res.status(upstream.status);
        const ct = upstream.headers["content-type"] as string | undefined;
        if (ct) res.setHeader("content-type", ct);
        res.end(upstream.data);
      })
      .catch(next);
  });

  return {
    get url() {
      return `http://127.0.0.1:${port}`;
    },
    seed(uuid, opts) {
      store.seed(uuid, opts);
    },
    clear(uuid) {
      store.manuscripts.delete(uuid);
    },
    async start() {
      await new Promise<void>((resolve, reject) => {
        server = app.listen(port, () => resolve());
        server.on("error", reject);
      });
    },
    async stop() {
      if (!server) return;
      await new Promise<void>((resolve, reject) => {
        server?.close((err) => (err ? reject(err) : resolve()));
      });
      server = null;
    },
  };
};
