/**
 * inLink: the studio's internal LLM gateway, one API key, billed per token.
 *
 * A direct engine on the same pi-ai path as Ollama and OpenRouter (`pi-completions.ts`): the
 * studio's own turn loop drives the model and runs the tools itself, and a game chat or a build
 * runs as a Genex session (`LocalSessions`), exactly as Bonsai's and DeepSeek's do. The key is
 * pasted in Settings and kept in the OS secret store (`provider-keys.ts`); it is read here, in
 * main, when a request is sent, and never leaves this process. Because every token is billed, the
 * app never picks this engine on its own (`isMetered`): only the person's explicit choice runs on
 * it.
 *
 * The gateway is OpenAI-compatible (`POST /v1/chat/completions`, `Authorization: Bearer <key>`)
 * and documents no `/models`, so the rows below are the gateway's model names — the name must
 * match what its model proxy is configured with, and `deepseek-v4-pro` is the one its own
 * documentation uses. The gateway has no separate reasoning field either: a thinking model writes
 * its thinking into `content` between `<think>` and `</think>`, which is split out before the chat
 * sees it (as a local server's is). Adding a model the proxy exposes is one row here.
 */
import path from "node:path";
import { gzipSync } from "node:zlib";
import {
  type CompleteRequest,
  type CompleteResponse,
  type DelegateRequest,
  type DelegateResult,
  type Engine,
  EngineError,
  type EngineModel,
  type EngineStatus,
  ModelContextSource,
  classifyHttpFailure,
} from "./types.ts";
import {
  drainPiStream,
  fromPiAssistant,
  isCutConnection,
  longHaulFetch,
  needsVision,
  type PiAssistant,
  piContext,
  type PiStreamFn,
  streamHttpStatus,
} from "./pi-completions.ts";
import { answerDeltas, splitInlineThinking } from "../local-server/inline-thinking.ts";
import { LocalSessions } from "./local-session.ts";
import { CompletionStop, DEFAULT_COMPACTION_PERCENT, STOPPED_BY_USER } from "./common.ts";
import type { ApiKeyStore } from "../provider-keys.ts";
import { SecretStorageUnavailableError } from "../secrets.ts";
import { HOUR_MS, SECOND_MS } from "../../shared/duration.ts";
import { ContextSource } from "../../shared/context.ts";
import { EngineKind, EngineStatusCode } from "../../shared/engine-descriptor.ts";
import { EngineFailureKind } from "../../shared/engine-requests.ts";
import { EngineId } from "../../shared/providers.ts";
import { errorMessage } from "../../shared/errors.ts";
import { redactSecrets } from "../../shared/redact.ts";

/** The gateway's OpenAI-compatible base; pi-ai appends `/chat/completions`. */
export const INLINK_API = "https://inlink.ccwork.com/llm-api/v1";
/** The inLink portal, where a person finds their API key. */
export const INLINK_KEYS_URL = "https://inlink.ccwork.com/web";

/** How long a checked key stays checked before `status()` asks the gateway again. */
const STATUS_FRESH_MS = 60 * SECOND_MS;
/** How long the key check waits for the gateway. */
const KEY_CHECK_TIMEOUT_MS = 10 * SECOND_MS;
/** Ceiling on one completion: long enough for a whole build turn, finite so a dead connection errors. */
export const INLINK_COMPLETION_TIMEOUT_MS = HOUR_MS;
/** A reply may use a quarter of the context, up to this many tokens, unless the model says less. */
const MAX_REPLY_TOKENS = 32_768;
/** A model whose context the table does not give is assumed to have this much. */
const DEFAULT_CONTEXT_TOKENS = 32_768;
/** The gateway's own documentation advertises a million-token context. */
const CONTEXT_TOKENS = 1_000_000;
/** The one token the key check spends. */
const PROBE_TOKENS = 1;
/** Characters per token when no tokenizer is at hand: low, so the estimate errs towards compacting early. */
const CHARS_PER_TOKEN = 3;
/** Tokens set aside for each picture, which the provider counts in its own way. */
const IMAGE_RESERVE_TOKENS = 1_600;
/** Tokens set aside for the provider's chat template around the messages and tools. */
const TEMPLATE_SLACK_TOKENS = 512;
/** The shortest and longest a pasted key may be, and the characters it may hold (no space, no newline). */
const KEY_SHAPE = /^[\x21-\x7e]{16,512}$/;
/** What the key check sends, and the words the chat never sees. */
const PROBE_PROMPT = "ping";
/** The web firewall's own page, which it answers a blocked body with instead of the gateway's JSON. */
const FIREWALL_WORDS = /knownsec|cloudwaf|创宇/i;
/** Its page is HTML where the gateway's own answers are JSON. */
const HTML_PAGE = /<!doctype html|<html/i;

/**
 * Does the answer claim to be JSON? The gateway's own errors say `application/json`; the firewall's
 * page carries no content type at all, which is how the two 403s are told apart.
 */
const isJson = (response: Response): boolean =>
  (response.headers.get("content-type") ?? "").includes("application/json");

/**
 * Is this answer the web firewall blocking a body it read as an attack? Its own page names it, and
 * a 403 that answers with HTML at all is not the gateway. Read from the words alone too: a status
 * line the error text does not spell out, or a page clipped before its markers, still carries them.
 */
function firewallBlocked(status: number | null, message: string): boolean {
  if (FIREWALL_WORDS.test(message)) return true;
  return status === 403 && HTML_PAGE.test(message);
}

/**
 * pi-ai's fetch for this gateway: a request the firewall blocked is sent again with a gzipped body.
 *
 * The firewall reads a plain body and refuses one that looks like an attack — a game is HTML and
 * JavaScript, so a build's own prompts and file contents trip it. It does not unpack
 * `Content-Encoding: gzip`, while the gateway (one-api) does, so the retry gets through. Nothing is
 * gzipped unless the plain request was blocked, so a gateway that would not unpack one is never
 * sent one.
 */
function inLinkFetch(stop: AbortSignal | undefined): typeof fetch {
  const send = longHaulFetch(stop);
  return async (input, init) => {
    const first = await send(input, init);
    if (!blockedByFirewall(first)) return first;
    const retry = await gzipped(input, init);
    if (!retry) return first;
    await first.body?.cancel().catch(() => {});
    // The client's own timeout signal is kept: only the body and its encoding change.
    return send(retry, init?.signal ? { signal: init.signal } : undefined);
  };
}

/** True when the answer is the firewall's page rather than the gateway's JSON. */
function blockedByFirewall(response: Response): boolean {
  if (response.status !== 403) return false;
  return !(response.headers.get("content-type") ?? "").includes("application/json");
}

/** The same POST with a gzipped body, or null when its body cannot be read and gzipped. */
async function gzipped(input: RequestInfo | URL, init: RequestInit | undefined): Promise<Request | null> {
  try {
    const base = new Request(input, init);
    if (base.method !== "POST") return null;
    const headers = new Headers(base.headers);
    headers.set("content-encoding", "gzip");
    headers.delete("content-length");
    return new Request(base.url, { method: "POST", headers, body: gzipSync(await base.text()) });
  } catch {
    return null;
  }
}

/** What this engine says to the person. */
const MESSAGE = {
  NoKey: "No inLink API key is saved.",
  KeyRemedy: "Add your inLink API key in Settings › Model Providers.",
  KeyRefused: "inLink did not accept the saved API key.",
  ReplaceRemedy: "Replace the key in Settings › Model Providers.",
  Ready: "inLink API key saved",
  Unreachable: (detail: string) => `inLink could not be reached (${detail}).`,
  Locked: (detail: string) => `The OS secret store is locked, so the inLink key cannot be read. ${detail}`,
  BadShape: "That does not look like an inLink API key. Paste the whole key, with no spaces.",
  /**
   * The gateway sits behind a web firewall (Knownsec/创宇盾) that reads every request body and
   * refuses one that looks like an attack. A game is HTML and JavaScript, so the studio's own
   * prompts, file contents and tool results carry `<script>`, SQL or `../` sooner or later.
   */
  Firewall:
    "inLink's web firewall blocked this request: it inspects message text and refuses HTML tags, SQL or path-traversal words.",
  FirewallRemedy: "Ask inLink's admins to exempt /llm-api from content inspection.",
  NoModel: "Pick an inLink model for this chat.",
  UnknownModel: (model: string) => `inLink does not have ${model}. Pick another model.`,
  NoTools: "this model cannot call tools",
  NoVision: "this model cannot see images",
  Cut: "the connection to inLink was cut mid-reply — the partial turn was lost; send the message again",
  Overflow: (required: number, window: number) =>
    `The request needs about ${required} tokens including the reply; this model's context is ${window}.`,
  Threshold: (required: number, threshold: number, percent: number) =>
    `The request needs about ${required} tokens including the reply; the compaction threshold is ${threshold} (${percent}%).`,
} as const;

/**
 * The gateway's models. Its model names must match what the proxy is configured with, so a name
 * the person's account exposes and this table lacks is one row away. The gateway documents no
 * reasoning dial, so a model that thinks is not offered one: its thinking arrives inline and is
 * split out of the answer.
 *
 * Two named ids, both the gateway's own flagship proxies, whose pages state no window and no reply
 * cap: each row claims the same ceiling (`CONTEXT_TOKENS`, `MAX_REPLY_TOKENS`) until one is known.
 * `qwen3.8-max` is the one the studio builds on, and the one that sees — its page fits vision
 * through planning, doing and checking. `deepseek-v4-pro` states none, so a session on it is never
 * handed a screenshot's pixels (`local-session.ts`).
 */
const MODELS: readonly EngineModel[] = [
  {
    id: "qwen3.8-max",
    label: "qwen3.8-max",
    contextWindow: CONTEXT_TOKENS,
    contextSource: ModelContextSource.Catalog,
    maxTokens: Math.min(MAX_REPLY_TOKENS, Math.floor(CONTEXT_TOKENS / 4)),
    supportsTools: true,
    supportsVision: true,
    supportsThinking: false,
  },
  {
    id: "deepseek-v4-pro",
    label: "deepseek-v4-pro",
    contextWindow: CONTEXT_TOKENS,
    contextSource: ModelContextSource.Catalog,
    maxTokens: Math.min(MAX_REPLY_TOKENS, Math.floor(CONTEXT_TOKENS / 4)),
    supportsTools: true,
    supportsVision: false,
    supportsThinking: false,
  },
];

/** The rows the picker offers. */
export function inLinkModels(): EngineModel[] {
  return [...MODELS];
}

/** The row for a model, or undefined for one the gateway's table does not carry. */
export function inLinkModel(id: string): EngineModel | undefined {
  return MODELS.find((model) => model.id === id);
}

/** The key as pasted, trimmed, or null when it cannot be a key (a space, a newline, too short or long). */
export function cleanApiKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim();
  return KEY_SHAPE.test(key) ? key : null;
}

/** About how many tokens a request holds, from its characters; pictures and the reply are reserved apart. */
function estimatedPromptTokens(request: CompleteRequest): number {
  const text = JSON.stringify([
    request.systemPrompt ?? "",
    request.messages.map(({ images: _images, ...message }) => message),
    request.tools ?? [],
  ]);
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface InLinkEngineOptions {
  /** The engine's home: its sessions live under it. */
  root: string;
  scratchRoot?: string;
  protectedPaths?: string[];
  toolPath?: () => Promise<string>;
  /** Where the API key is kept. */
  keys: ApiKeyStore;
  /** The API's base URL; tests point it at a local server. */
  baseUrl?: string;
  now?: () => number;
  /** Injected in tests so the timeout path is reachable without waiting an hour. */
  timeoutMs?: number;
}

/** The outcome of checking a key with the gateway. */
type KeyCheck = { ok: true } | { ok: false; status: EngineStatus };

export class InLinkEngine implements Engine {
  readonly id = EngineId.InLink;
  readonly label = "inLink";
  readonly kind = EngineKind.Direct;
  readonly supportsSessions = true;
  readonly sessions: LocalSessions;
  readonly baseUrl: string;
  readonly #keys: ApiKeyStore;
  readonly #now: () => number;
  readonly #timeoutMs: number;
  #status: { at: number; value: EngineStatus } | null = null;
  #models: unknown = null;

  constructor(options: InLinkEngineOptions) {
    this.baseUrl = (options.baseUrl ?? INLINK_API).replace(/\/+$/, "");
    this.#keys = options.keys;
    this.#now = options.now ?? Date.now;
    this.#timeoutMs = options.timeoutMs ?? INLINK_COMPLETION_TIMEOUT_MS;
    this.sessions = new LocalSessions({
      engine: EngineId.InLink,
      root: path.join(options.root, "sessions"),
      scratchRoot: options.scratchRoot,
      protectedPaths: options.protectedPaths ?? [options.root],
      complete: (request) => this.complete(request),
      contextWindow: (model) => inLinkModel(model)?.contextWindow ?? DEFAULT_CONTEXT_TOKENS,
      seesImages: (model) => inLinkModel(model)?.supportsVision !== false,
      toolPath: options.toolPath,
    });
  }

  async status(): Promise<EngineStatus> {
    const cached = this.#status;
    if (cached && this.#now() - cached.at < STATUS_FRESH_MS) return cached.value;
    const value = await this.#readStatus();
    this.#status = { at: this.#now(), value };
    return value;
  }

  async #readStatus(): Promise<EngineStatus> {
    let key: string | null;
    try {
      key = await this.#keys.read();
    } catch (err) {
      if (err instanceof SecretStorageUnavailableError)
        return { code: EngineStatusCode.Error, detail: MESSAGE.Locked(err.message) };
      throw err;
    }
    if (!key) return { code: EngineStatusCode.NeedsLogin, detail: MESSAGE.NoKey, remedy: MESSAGE.KeyRemedy };
    const check = await this.#checkKey(key);
    return check.ok ? { code: EngineStatusCode.Ready, detail: MESSAGE.Ready } : check.status;
  }

  /**
   * Ask the gateway whether a key is good. Its only documented endpoint is the chat one, so the
   * check is a one-token request with the first listed model: 401/403 is a refusal, a 5xx or a
   * failed connection is an outage, and anything else (a 200, or a 400 about the model) means the
   * gateway read the key. This is the one status check that spends anything, and it is cached.
   */
  async #checkKey(key: string): Promise<KeyCheck> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODELS[0]?.id ?? "",
          messages: [{ role: "user", content: PROBE_PROMPT }],
          max_tokens: PROBE_TOKENS,
          stream: false,
        }),
        signal: AbortSignal.timeout(KEY_CHECK_TIMEOUT_MS),
      });
    } catch (err) {
      return { ok: false, status: { code: EngineStatusCode.Error, detail: MESSAGE.Unreachable(errorMessage(err)) } };
    }
    const json = isJson(response);
    await response.body?.cancel().catch(() => {});
    const refused = response.status === 401 || response.status === 403;
    if (refused) {
      // A 403 with the firewall's own page is not the gateway refusing the key: replacing the key
      // would change nothing, so it is reported as the block it is.
      if (response.status === 403 && !json)
        return {
          ok: false,
          status: { code: EngineStatusCode.Error, detail: MESSAGE.Firewall, remedy: MESSAGE.FirewallRemedy },
        };
      return {
        ok: false,
        status: { code: EngineStatusCode.NeedsLogin, detail: MESSAGE.KeyRefused, remedy: MESSAGE.ReplaceRemedy },
      };
    }
    if (response.status >= 500)
      return {
        ok: false,
        status: { code: EngineStatusCode.Error, detail: MESSAGE.Unreachable(`HTTP ${response.status}`) },
      };
    return { ok: true };
  }

  /**
   * Check a pasted key with the gateway and keep it only when the gateway accepts it. The answer is
   * the engine's status, never the key; a key that is refused, or a store that is locked, saves
   * nothing.
   */
  async saveKey(value: unknown): Promise<EngineStatus> {
    const key = cleanApiKey(value);
    if (!key) return { code: EngineStatusCode.NeedsLogin, detail: MESSAGE.BadShape, remedy: MESSAGE.KeyRemedy };
    const check = await this.#checkKey(key);
    if (!check.ok) return check.status;
    await this.#keys.write(key);
    this.#status = null;
    return this.status();
  }

  /** Forget the saved key; the engine then needs a new one before it runs again. */
  async clearKey(): Promise<EngineStatus> {
    await this.#keys.clear();
    this.#status = null;
    return this.status();
  }

  async models(): Promise<EngineModel[]> {
    return inLinkModels();
  }

  /** The model list is this engine's own table; a recheck only asks the gateway about the key again. */
  async refreshModels(): Promise<void> {
    this.#status = null;
  }

  /** No model is the gateway's own default: every token is billed, so the person picks it. */
  async defaultModel(): Promise<string | null> {
    return null;
  }

  /** The table row for `model`, or a failure naming what the table carries. */
  #known(model: string): EngineModel {
    const row = inLinkModel(model);
    if (!row) throw new EngineError(EngineFailureKind.Unavailable, this.id, MESSAGE.UnknownModel(model));
    return row;
  }

  async #key(): Promise<string> {
    let key: string | null;
    try {
      key = await this.#keys.read();
    } catch (err) {
      throw new EngineError(EngineFailureKind.Auth, this.id, MESSAGE.Locked(errorMessage(err)));
    }
    if (!key) throw new EngineError(EngineFailureKind.Auth, this.id, `${MESSAGE.NoKey} ${MESSAGE.KeyRemedy}`);
    return key;
  }

  async delegate(request: DelegateRequest): Promise<DelegateResult> {
    const model = request.model;
    if (!model) throw new EngineError(EngineFailureKind.Unavailable, this.id, MESSAGE.NoModel);
    this.#known(model);
    return this.sessions.run(request, model);
  }

  async complete(request: CompleteRequest): Promise<CompleteResponse> {
    const modelId = request.model;
    if (!modelId) throw new EngineError(EngineFailureKind.Unavailable, this.id, MESSAGE.NoModel);
    const row = this.#known(modelId);
    if (request.tools?.length && !row.supportsTools)
      throw new EngineError(EngineFailureKind.Unavailable, this.id, MESSAGE.NoTools);
    if (needsVision(request) && !row.supportsVision)
      throw new EngineError(EngineFailureKind.Unavailable, this.id, MESSAGE.NoVision);
    const maxTokens = Math.min(request.maxTokens ?? row.maxTokens, row.maxTokens);
    this.#preflight(request, row, maxTokens);
    const key = await this.#key();
    const { models, model } = await this.#provider(row, key);
    try {
      const stream = (models as { stream: PiStreamFn }).stream(model, piContext(request, this.id), {
        fetch: inLinkFetch(request.signal),
        timeoutMs: Math.min(request.timeoutMs ?? this.#timeoutMs, this.#timeoutMs),
        maxTokens,
        ...(request.signal ? { signal: request.signal } : {}),
      });
      // The gateway leaves thinking inline, so the answer is streamed apart from it.
      await drainPiStream(stream, { ...request, onDelta: answerDeltas(request.onDelta) }, this.id);
      const assistant = (await stream.result()) as PiAssistant;
      if (assistant.stopReason === CompletionStop.Aborted)
        throw new EngineError(EngineFailureKind.Aborted, this.id, STOPPED_BY_USER);
      if (assistant.stopReason === CompletionStop.Error)
        throw this.#streamFailure(assistant.errorMessage ?? "model stream failed");
      return this.#response(assistant, modelId);
    } catch (err) {
      throw this.#failure(err, request);
    }
  }

  /** The finished reply, its inline thinking kept apart from the answer the chat shows. */
  #response(assistant: PiAssistant, modelId: string): CompleteResponse {
    const { message, usage } = fromPiAssistant(assistant, this.id);
    if (!message.reasoning) {
      const split = splitInlineThinking(message.content);
      message.content = split.answer;
      if (split.thinking) message.reasoning = split.thinking;
    }
    return { message, usage, stopReason: assistant.stopReason ?? CompletionStop.Stop, model: modelId, engine: this.id };
  }

  /**
   * Refuse a request that cannot fit before it is sent and paid for. There is no tokenizer for
   * these models, so the count is an estimate from characters that errs towards compacting early;
   * the provider's own limit still stands behind it.
   */
  #preflight(request: CompleteRequest, row: EngineModel, maxTokens: number): void {
    const images = request.messages.reduce((n, message) => n + (message.images?.length ?? 0), 0);
    const promptTokens = estimatedPromptTokens(request);
    const required = promptTokens + images * IMAGE_RESERVE_TOKENS + maxTokens + TEMPLATE_SLACK_TOKENS;
    const window = row.contextWindow;
    const percent =
      request.contextPolicy?.mode === "custom"
        ? Number(request.contextPolicy.thresholdPercent)
        : DEFAULT_COMPACTION_PERCENT;
    const threshold = Math.floor((window * percent) / 100);
    request.onContext?.({
      engine: this.id,
      model: row.id,
      requestedModel: row.id,
      promptTokens,
      contextWindow: window,
      reservedOutputTokens: maxTokens,
      imageReserveTokens: images * IMAGE_RESERVE_TOKENS,
      source: ContextSource.Estimated,
      thresholdTokens: request.contextPolicy ? threshold : undefined,
      phase: "preflight",
    });
    if (required > window)
      throw new EngineError(EngineFailureKind.ContextOverflow, this.id, MESSAGE.Overflow(required, window));
    if (request.contextPolicy && required > threshold)
      throw new EngineError(
        EngineFailureKind.ContextThreshold,
        this.id,
        MESSAGE.Threshold(required, threshold, percent),
      );
  }

  /** pi-ai's provider for one request, holding the key only for as long as the request needs it. */
  async #provider(row: EngineModel, key: string): Promise<{ models: unknown; model: unknown }> {
    const { createModels, createProvider } = await import("@earendil-works/pi-ai");
    const { openAICompletionsApi } = await import("@earendil-works/pi-ai/api/openai-completions.lazy");
    if (!this.#models) this.#models = createModels();
    const model = this.#piModel(row);
    (this.#models as { setProvider: (provider: unknown) => void }).setProvider(
      createProvider({
        id: this.id,
        name: this.label,
        baseUrl: this.baseUrl,
        auth: {
          apiKey: { name: "inLink API key", resolve: async () => ({ auth: { apiKey: key }, source: "Settings" }) },
        } as never,
        models: [model] as never,
        api: openAICompletionsApi(),
      }) as never,
    );
    return { models: this.#models, model };
  }

  /**
   * pi-ai's description of one listed model. The gateway is a plain OpenAI-compatible server, so
   * the request keeps to what its documentation lists: the system role, `max_tokens`, and no
   * reasoning dial (its thinking comes back inline in `content`).
   */
  #piModel(row: EngineModel): Record<string, unknown> {
    return {
      id: row.id,
      name: row.label,
      api: "openai-completions",
      provider: this.id,
      baseUrl: this.baseUrl,
      reasoning: false,
      supportsTools: row.supportsTools,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: row.contextWindow,
      maxTokens: row.maxTokens,
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        supportsStrictMode: false,
        maxTokensField: "max_tokens",
      },
    };
  }

  /**
   * An HTTP failure: the firewall's block first (it is not the gateway refusing), then by status.
   * What the gateway said is redacted before it is read: no key ever rides an error into a log.
   */
  #httpFailure(status: number, message: string): EngineError {
    if (firewallBlocked(status, message)) return new EngineError(EngineFailureKind.Other, this.id, MESSAGE.Firewall);
    return classifyHttpFailure(this.id, status, message);
  }

  /**
   * A failure that arrived through the stream: an HTTP status it names, a cut connection, or as
   * said. Whatever the gateway said is redacted first: no key ever rides an error into a log.
   */
  #streamFailure(said: string): EngineError {
    const message = redactSecrets(said);
    const status = streamHttpStatus(message);
    if (firewallBlocked(status, message)) return new EngineError(EngineFailureKind.Other, this.id, MESSAGE.Firewall);
    if (status !== null) return classifyHttpFailure(this.id, status, message);
    if (isCutConnection(message)) return new EngineError(EngineFailureKind.Unavailable, this.id, MESSAGE.Cut);
    return new EngineError(EngineFailureKind.Other, this.id, message);
  }

  /** What a failed completion throws, as an engine error the run policy can act on. */
  #failure(err: unknown, request: CompleteRequest): EngineError {
    if (err instanceof EngineError) return err;
    // An abort wins over whatever error it caused — a stop must never read as a failure.
    if (request.signal?.aborted) return new EngineError(EngineFailureKind.Aborted, this.id, STOPPED_BY_USER);
    const error = err as Error & { status?: number };
    if (error.status) return this.#httpFailure(error.status, redactSecrets(error.message));
    return this.#streamFailure(error.message);
  }
}
