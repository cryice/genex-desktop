/**
 * A real HTTP server speaking the part of the inLink gateway the engine uses: the
 * OpenAI-compatible `chat/completions` endpoint, streamed (SSE) or not, with the Bearer key checked.
 * pi-ai does real HTTP and SSE against it, so the engine's key check, streaming, inline thinking
 * and failure mapping are exercised for real, with no network and no gateway account.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gunzipSync } from "node:zlib";
import { type FakeReply, writeChatCompletion } from "./fake-ollama.ts";

/** A key this server accepts. */
export const GOOD_KEY = "inlink-0123456789abcdef0123456789abcdef";

/** What the gateway's web firewall reads a plain body as an attack for, as it does in production. */
const FIREWALL = /<\s*script|select\s+.+\s+from|union\s+select|\.\.\/|eval\s*\(/i;
/** The page the firewall answers with: HTML, and no content type at all. */
const FIREWALL_PAGE = "<!DOCTYPE html><html><body>Knownsec CloudWAF: suspected hacking</body></html>";

export interface FakeInLinkOptions {
  /**
   * What an accepted key answers with, instead of the normal reply: the gateway's own 400 about a
   * model, say. `contentType: null` sends no content type at all, as the web firewall's page does.
   */
  accepted?: { status: number; body: string; contentType?: string | null };
  /** Mirror the production firewall: a plain body that reads as an attack is refused with its page. */
  firewall?: boolean;
  /** Keys this server accepts; any other is refused with 401. */
  keys?: string[];
  replies?: FakeReply[];
}

export interface FakeInLink {
  baseUrl: string;
  requests: Array<{ path: string; body: unknown; authorization: string | undefined; encoding: string | undefined }>;
  close: () => Promise<void>;
}

/** A request's text: a gzipped body is unpacked, as the gateway unpacks it. */
function decodeBody(bytes: Buffer, encoding: string | string[] | undefined): string {
  if (encoding !== "gzip") return bytes.toString("utf8");
  try {
    return gunzipSync(bytes).toString("utf8");
  } catch {
    return bytes.toString("utf8");
  }
}

export async function startFakeInLink(options: FakeInLinkOptions = {}): Promise<FakeInLink> {
  const keys = options.keys ?? [GOOD_KEY];
  const replies = [...(options.replies ?? [])];
  const requests: FakeInLink["requests"] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const encoding = req.headers["content-encoding"];
      const raw = decodeBody(Buffer.concat(chunks), encoding);
      let body: unknown = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }
      const url = req.url ?? "/";
      requests.push({
        path: url,
        body,
        authorization: req.headers.authorization,
        encoding: typeof encoding === "string" ? encoding : undefined,
      });
      const json = (value: unknown, status = 200) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(value));
      };
      const keyGiven = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
      if (url.startsWith("/chat/completions")) {
        // The firewall reads a plain body and refuses one that reads as an attack; it never unpacks
        // a gzipped one, which is the retry the engine relies on.
        if (options.firewall && encoding !== "gzip" && FIREWALL.test(raw)) {
          res.writeHead(403);
          return res.end(FIREWALL_PAGE);
        }
        if (!keys.includes(keyGiven))
          return json({ error: { message: "invalid api key", type: "authentication_error" } }, 401);
        if (options.accepted) {
          const { status, body, contentType = "application/json" } = options.accepted;
          res.writeHead(status, contentType ? { "content-type": contentType } : {});
          return res.end(body);
        }
        // The key check asks without streaming; a completion streams.
        const asked = body as { stream?: boolean; model?: string } | null;
        if (asked?.stream === false)
          return json({
            id: "chat-probe",
            object: "chat.completion",
            created: 1,
            model: asked.model ?? "probe",
            choices: [{ index: 0, message: { role: "assistant", content: "pong" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          });
        return writeChatCompletion(res, body, replies.shift() ?? { text: "ok" });
      }
      json({ error: `unhandled ${url}` }, 404);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
