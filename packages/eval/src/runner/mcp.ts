import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface McpClient {
  listTools(): Promise<McpTool[]>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    timeout?: number,
  ): Promise<McpToolResult>;
  close(): Promise<void>;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  content: unknown;
  isError: boolean;
}

export async function createMcpClient(
  baseUrl: string,
  token?: string,
): Promise<McpClient> {
  const client = new Client({
    name: "eval-plain-runner",
    version: "0.0.1",
  });

  const transport = new StreamableHTTPClientTransport(
    new URL(`${baseUrl}/mcp`),
    token
      ? {
          requestInit: {
            headers: {
              "x-token": token,
            },
          },
        }
      : undefined,
  );

  await client.connect(transport as any);

  return {
    async listTools(): Promise<McpTool[]> {
      const result = await client.listTools();
      return result.tools.map((tool) => ({
        name: tool.name,
        ...(tool.description !== undefined
          ? { description: tool.description }
          : {}),
        inputSchema: tool.inputSchema as Record<string, unknown>,
      }));
    },
    async callTool(
      name: string,
      args: Record<string, unknown>,
      timeout?: number,
    ): Promise<McpToolResult> {
      const result = await client.callTool(
        { name, arguments: args },
        undefined,
        timeout ? { timeout } : undefined,
      );
      return {
        content: result.content,
        isError: result.isError === true,
      };
    },
    async close(): Promise<void> {
      await client.close();
    },
  };
}
