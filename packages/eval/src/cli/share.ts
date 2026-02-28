import { isRecord } from "../utils/type-guards.ts";

export type ShareOutcome =
  | { status: "shared"; shareUrl: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

function resolveShareBaseURL(baseUrlOption?: string): string | undefined {
  const candidate = baseUrlOption ?? process.env["EVAL_SHARE_BASE_URL"];
  if (!candidate) {
    return undefined;
  }
  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function uploadHtmlReport(options: {
  html: string;
  filename: string;
  baseUrl: string;
  token?: string;
}): Promise<string> {
  const endpoint = new URL("/api/share/report", options.baseUrl).toString();
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (options.token && options.token.trim().length > 0) {
    headers["authorization"] = `Bearer ${options.token}`;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      html: options.html,
      filename: options.filename,
    }),
  });

  if (!response.ok) {
    throw new Error(`share upload failed (${response.status})`);
  }

  const payload: unknown = await response.json().catch(() => {
    throw new Error("share upload returned invalid json");
  });

  if (!isRecord(payload) || typeof payload["share_url"] !== "string") {
    throw new Error("share upload response missing share_url");
  }

  return payload["share_url"];
}

export async function maybeShareHtmlReport(options: {
  enabled: boolean;
  html: string;
  filename: string;
  baseUrlOption?: string;
}): Promise<ShareOutcome> {
  if (!options.enabled) {
    return { status: "skipped", reason: "disabled by --no-share" };
  }

  const baseUrl = resolveShareBaseURL(options.baseUrlOption);
  if (!baseUrl) {
    return {
      status: "failed",
      reason:
        "missing share service url (set --share-base-url or EVAL_SHARE_BASE_URL)",
    };
  }

  try {
    const shareUrl = await uploadHtmlReport({
      html: options.html,
      filename: options.filename,
      baseUrl,
      token: process.env["EVAL_SHARE_TOKEN"],
    });
    return { status: "shared", shareUrl };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { status: "failed", reason };
  }
}
