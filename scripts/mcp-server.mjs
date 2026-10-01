#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { getPublicPolicy } from "./lib/agent-policy.mjs";
import { ghostclawHome } from "./lib/paths.mjs";
import { fetchDetailed } from "./lib/x402-client.mjs";

process.env.GHOSTCLAW_MCP_CHILD = "1";
process.umask(0o077);

const MAX_RESOURCE_BYTES = 1024 * 1024;
const server = new McpServer({ name: "ghostclaw", version: "1.5.7" });

function safeError(error) {
  const message = String(error?.message ?? "The GhostClaw action failed.")
    .replaceAll(ghostclawHome, "[LOCAL_WALLET]")
    .replace(/\/?[^\s"']*\.ghostclaw[^\s"']*/g, "[LOCAL_WALLET]")
    .slice(0, 500);
  return {
    code: typeof error?.code === "string" ? error.code : "GHOSTCLAW_PAYMENT_FAILED",
    message,
    ...(typeof error?.approvalId === "string" ? { approvalId: error.approvalId } : {}),
    ...(Array.isArray(error?.reasons) ? { reasons: error.reasons.slice(0, 8) } : {}),
  };
}

function toolResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

function toolError(error) {
  const value = safeError(error);
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

async function resourceBody(response) {
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_RESOURCE_BYTES) {
    throw Object.assign(new Error("The paid resource exceeds the 1 MiB MCP response limit."), {
      code: "GHOSTCLAW_RESOURCE_TOO_LARGE",
    });
  }
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const text = /^(?:text\/|application\/(?:json|problem\+json|xml|javascript))/i.test(contentType);
  return {
    contentType,
    encoding: text ? "utf8" : "base64",
    body: text ? bytes.toString("utf8") : bytes.toString("base64"),
  };
}

server.registerTool("ghostclaw_fetch", {
  title: "GhostClaw fetch",
  description: "Fetch a resource. Pay a valid GhostClaw x402 requirement inside the human-approved budget.",
  inputSchema: {
    url: z.url().describe("The HTTPS resource URL."),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]).default("GET"),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().max(MAX_RESOURCE_BYTES).optional(),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
}, async ({ url, method, headers, body }) => {
  try {
    const { response, payment } = await fetchDetailed(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
    });
    const resource = await resourceBody(response);
    return toolResult({
      status: response.status,
      resource,
      payment,
    });
  } catch (error) {
    return toolError(error);
  }
});

server.registerTool("ghostclaw_check_budget", {
  title: "Check GhostClaw budget",
  description: "Read the public agent spending limits and remaining session totals. This tool returns no private balance.",
  inputSchema: {},
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
}, async () => {
  try {
    return toolResult(await getPublicPolicy());
  } catch (error) {
    return toolError(error);
  }
});

await server.connect(new StdioServerTransport());
