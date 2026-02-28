import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export type McpServerOptions = {
  name: string;
  version: string;
  url: string;
  headers: Record<string, string>;
  toolFilter?: {
    allowedToolNames?: string[];
    needsApprovalToolNames?: string[];
  };
};

export const createMcpServer = (options: McpServerOptions) => {
  const client = new Client({
    name: options.name,
    version: options.version,
  });

  const transport = new StreamableHTTPClientTransport(new URL(options.url), {
    requestInit: {
      headers: options.headers,
    },
  });

  const connect = async () => {
    await client.connect(transport);
  };

  const close = async () => {
    await client.close();
  };

  const listTools = async () => {
    return await client.listTools().then((res) => res.tools);
  };

  const callTool = async (
    name: string,
    parameters?: Record<string, unknown>,
    _meta?: Record<string, unknown>,
  ) => {
    return await client.callTool(
      {
        name,
        arguments: parameters,
        _meta,
      },
      undefined,
      {
        timeout: 60 * 1000 * 20,
      },
    );
  };

  return {
    connect,
    close,
    listTools,
    callTool,
  };
};
