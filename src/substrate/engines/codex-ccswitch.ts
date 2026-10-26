/**
 * cc-switch's Codex providers, read for the engine.
 *
 * cc-switch (farion1231/cc-switch) is a desktop app that manages providers for Claude Code,
 * Codex and Gemini CLI. For Codex it rewrites `~/.codex/config.toml`: a top-level
 * `model_provider` naming one `[model_providers.<id>]` table, and the key that table needs —
 * inline (`experimental_bearer_token`), in a variable the table names (`env_key`), in
 * `auth.json`'s `OPENAI_API_KEY` (where cc-switch puts a pasted key), or in a header.
 *
 * Genex is the consumer of that file, never the writer: cc-switch is the control plane, Genex
 * reads what it left. At launch the selected provider travels as CLI overrides (`-c`), so the
 * engine keeps its `--ignore-user-config` isolation and never loads the user's MCP servers,
 * notifications or projects. The key travels once, in the child's environment
 * ({@link PROVIDER_KEY_ENV}), from the file into the process: it is never written anywhere by
 * Genex, never enters an argv, a log line or the settings.
 *
 * Everything here is fail-closed. A TOML subset is parsed — exactly the shapes cc-switch and
 * the Codex CLI use — and anything it cannot read cleanly is "nothing to run"
 * ({@link CcswitchConfig}'s `none`), never a guess. A hosted relay's address is checked for
 * hygiene (http(s), no credentials, no control characters) but not for locality: unlike a
 * local model server, a cc-switch provider is a hosted API by design.
 */
import path from "node:path";
import {
  DISCOVERY_TIMEOUT_MS,
  type ModelFacts,
  ListAnswer,
  modelRow,
  readModelList,
  serverModels,
} from "../local-server/discovery.ts";
import { atomicWriteJson, isJsonObject, readJsonIfExists, readRegularFile } from "../fsx.ts";
import type { EngineModel } from "./types.ts";
import { CodexConnection } from "../../shared/codex-connection.ts";

/**
 * The environment variable a cc-switch key is read into, at launch and for the child only. The
 * `-c` override names it (`model_providers.<id>.env_key=…`), whatever the file itself named, so
 * one channel carries every key shape and no user variable name reaches an argv or a log.
 */
export const PROVIDER_KEY_ENV = "GENEX_CODEX_PROVIDER_KEY";

/** The largest config.toml read; the real one is a few kilobytes. */
const MAX_CONFIG_BYTES = 1024 * 1024;
/** The longest address read; a real one is a few dozen characters. */
const MAX_URL_CHARS = 2048;
/** A provider id the `-c` override can spell: a bare TOML key — no dots, no quotes. */
const BARE_KEY = /^[A-Za-z0-9_-]+$/;

/** Why there is nothing to run from cc-switch. Wire values: never rename one. */
export const CcswitchAbsence = {
  /** No config.toml at all: cc-switch has never written one here. */
  NoFile: "no_file",
  /** A file that cannot be read cleanly (too large, not text, malformed, unusable provider). */
  Unreadable: "unreadable",
  /** A readable file that selects no provider this app can run. */
  NoProvider: "no_provider",
  /** A provider without a key, from any of the four places one can live. */
  NoKey: "no_key",
} as const;
export type CcswitchAbsence = (typeof CcswitchAbsence)[keyof typeof CcswitchAbsence];

/** One provider definition, as the engine holds it after reading: no token fields, no key. */
export interface CcswitchProvider {
  /** The table key under `[model_providers.*]`, which `model_provider` names. */
  id: string;
  /** The provider's display name, when it has one. */
  name: string | null;
  /** The OpenAI-compatible base URL, trailing slash taken off. */
  baseUrl: string;
  /** The wire protocol the CLI speaks to it; `responses` unless the file says otherwise. */
  wireApi: "responses" | "chat";
  /** The environment variable the file named for the key, when it named one. */
  envKey: string | null;
  /** The model the file left selected, when it left one: the discovery fallback. */
  model: string | null;
}

/** What cc-switch left for Codex: the selected provider with its key, or why there is nothing. */
export type CcswitchConfig =
  | { kind: "provider"; provider: CcswitchProvider; key: string }
  | { kind: "none"; reason: CcswitchAbsence };

/** The parsed provider with the fields only key resolution reads; never leaves this module. */
interface ParsedProvider extends CcswitchProvider {
  bearerToken: string | null;
  headerKey: string | null;
}

// ── the TOML subset ───────────────────────────────────────────────────────────────────────────────

/** One value of the subset: a string, a boolean, or anything else (numbers, arrays, dates). */
type TomlValue = { kind: "string"; value: string } | { kind: "bool"; value: boolean } | { kind: "other" };

/** What the subset parse found, before anything is judged usable. */
interface CcswitchToml {
  /** Top-level keys (`model_provider`, `model`). */
  top: Map<string, TomlValue>;
  /** `[model_providers.<id>]` tables, by id. */
  providers: Map<string, Map<string, TomlValue>>;
  /** `[model_providers.<id>.headers]` tables, by id, header names lower-cased. */
  headers: Map<string, Map<string, string>>;
  /** A line the subset could not read. */
  malformed: boolean;
}

/**
 * Multi-line strings folded onto one line each. TOML lets a value span lines
 * (`"""line one\nline two"""`); a line reader would see half a string and call the rest of the
 * file garbage. Folding keeps the line reader honest without a full TOML parser: the folded
 * body keeps its newlines (escaped), so a `#` or a `[` inside it is never a comment or a table
 * header. An unterminated string is left as it is: the line reader calls the file malformed.
 */
/** A multi-line string (`"""` or `'''`) opening at `i`, folded onto one line; null when unterminated. */
function foldedMultiline(text: string, i: number, delimiter: string): { folded: string; next: number } | null {
  const close = text.indexOf(delimiter, i + 3);
  if (close === -1) return null;
  const body = text.slice(i + 3, close);
  const basic = delimiter === '"""' ? body.replace(/\\/g, "\\\\").replace(/"/g, '\\"') : body.replace(/'/g, "\\'");
  return { folded: `"${basic.replace(/\r?\n/g, "\\n")}"`, next: close + 3 };
}

/** Where the single-line string opening at `i` ends: at its closing quote, a newline, or the end. */
function singleLineStringEnd(text: string, i: number, quote: string): number {
  let j = i + 1;
  while (j < text.length) {
    if (quote === '"' && text[j] === "\\") {
      j += 2;
      continue;
    }
    if (text[j] === quote || text[j] === "\n") break;
    j++;
  }
  return j;
}

function foldMultilineStrings(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const three = text.slice(i, i + 3);
    if (three === '"""' || three === "'''") {
      const folded = foldedMultiline(text, i, three);
      if (!folded) return text;
      out += folded.folded;
      i = folded.next;
      continue;
    }
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      // A single-line string, copied verbatim: its escapes and any `#` or `[` inside are content.
      const end = singleLineStringEnd(text, i, ch);
      out += text.slice(i, Math.min(end + 1, text.length));
      i = end + 1;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Arrays and inline tables folded onto the line that opens them. TOML lets them span lines
 * (`notify = [\n "a",\n "b"\n]`); the continuation lines would otherwise read as stray values
 * and the file would be called malformed for something cc-switch never writes.
 */
/** Where the quoted run opening at `i` ends: past its closing quote, or at the end of text. */
function quotedRunEnd(text: string, i: number, quote: string): number {
  for (let j = i + 1; j < text.length; j++) {
    if (quote === '"' && text[j] === "\\") {
      j++;
      continue;
    }
    if (text[j] === quote) return j + 1;
  }
  return text.length;
}

function foldBrackets(text: string): string {
  let out = "";
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      const end = quotedRunEnd(text, i, ch);
      out += text.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
    else if (ch === "\n" && depth > 0) {
      out += " ";
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** The file's logical lines: no multi-line string, no multi-line array, no CR. */
function toLogicalLines(text: string): string[] {
  return foldBrackets(foldMultilineStrings(text.replace(/^\uFEFF/, "")))
    .split("\n")
    .map((line) => line.replace(/\r$/, ""));
}

/** A `#` outside a string starts a comment; inside one it is content. */
function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (quote === '"' && ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "#") return line.slice(0, i);
  }
  return line;
}

/** One key segment at `i` — quoted or bare — and where it ends; null when it does not read. */
function keySegment(text: string, i: number): { segment: string; next: number } | null {
  const ch = text[i];
  if (ch === '"' || ch === "'") {
    const close = text.indexOf(ch, i + 1);
    return close === -1 ? null : { segment: text.slice(i + 1, close), next: close + 1 };
  }
  const bare = /^[A-Za-z0-9_-]+/.exec(text.slice(i));
  return bare ? { segment: bare[0], next: i + bare[0].length } : null;
}

/** How far `skip` lets `from` run: the first index whose character it refuses. */
function skipWhile(text: string, from: number, skip: (ch: string) => boolean): number {
  let i = from;
  while (i < text.length && skip(text[i])) i++;
  return i;
}

/** A dotted key path (`a.b."c d"` → `["a", "b", "c d"]`), or null when a segment is malformed. */
function keyPath(text: string): string[] | null {
  const parts: string[] = [];
  let i = 0;
  for (;;) {
    i = skipWhile(text, i, (ch) => ch === "." || ch === " ");
    if (i >= text.length) break;
    const read = keySegment(text, i);
    if (!read) return null;
    parts.push(read.segment);
    i = skipWhile(text, read.next, (ch) => ch === " ");
    if (i < text.length && text[i] !== ".") return null;
  }
  return parts.length > 0 ? parts : null;
}

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", b: "\b", f: "\f" };

/** How many hex digits the escape named by `next` carries; 0 for any other escape. */
function escapeWidth(next: string | undefined): number {
  if (next === "u") return 4;
  if (next === "U") return 8;
  return 0;
}

/** The escape sequence at `i` (`\n`, `\uXXXX`), or null when it is not one this subset reads. */
function readEscape(value: string, i: number): { text: string; next: number } | null {
  const next = value[i + 1];
  if (next !== undefined && next in ESCAPES) return { text: ESCAPES[next], next: i + 2 };
  const width = escapeWidth(next);
  const hex = width ? value.slice(i + 2, i + 2 + width) : "";
  if (width && /^[0-9a-fA-F]+$/.test(hex)) {
    return { text: String.fromCodePoint(Number.parseInt(hex, 16)), next: i + 2 + width };
  }
  return null;
}

/** A basic string's value, escapes resolved; null when it does not close or holds a bad escape. */
function readBasicString(value: string): string | null {
  let out = "";
  let i = 1;
  while (i < value.length) {
    const ch = value[i];
    if (ch === "\\") {
      const escape = readEscape(value, i);
      if (!escape) return null;
      out += escape.text;
      i = escape.next;
      continue;
    }
    if (ch === '"') return out;
    out += ch;
    i++;
  }
  return null;
}

/** The value of one `key = value` line, or null when the subset does not read it. */
function parseValue(raw: string): TomlValue | null {
  const value = raw.trim();
  if (value === "") return null;
  if (value.startsWith('"')) {
    const read = readBasicString(value);
    return read === null ? null : { kind: "string", value: read };
  }
  if (value.startsWith("'")) {
    const close = value.indexOf("'", 1);
    return close === -1 ? null : { kind: "string", value: value.slice(1, close) };
  }
  if (value === "true") return { kind: "bool", value: true };
  if (value === "false") return { kind: "bool", value: false };
  if (/^[+-]?(\d[\d_]*(\.\d*)?([eE][+-]?\d+)?|\.\d+)$/.test(value)) return { kind: "other" };
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return { kind: "other" };
  if (value.startsWith("[") || value.startsWith("{")) return { kind: "other" };
  return null;
}

/** The fields of one `[model_providers.<id>]` table, made where missing. */
function providerTable(toml: CcswitchToml, id: string): Map<string, TomlValue> {
  let table = toml.providers.get(id);
  if (!table) {
    table = new Map();
    toml.providers.set(id, table);
  }
  return table;
}

/** The headers of one `[model_providers.<id>.headers]` table, made where missing. */
function headerTable(toml: CcswitchToml, id: string): Map<string, string> {
  let table = toml.headers.get(id);
  if (!table) {
    table = new Map();
    toml.headers.set(id, table);
  }
  return table;
}

/** Record one `key = value` under its table, keeping only the shapes this module reads. */
function place(toml: CcswitchToml, table: string[], key: string[], value: TomlValue): void {
  if (table.length === 0) {
    toml.top.set(key.join("."), value);
    // A dotted top-level key (`model_providers.custom.base_url = …`) writes the provider table too.
    if (key[0] === "model_providers" && key.length === 3) providerTable(toml, key[1]).set(key[2], value);
    return;
  }
  if (table[0] === "model_providers" && table.length === 2) {
    providerTable(toml, table[1]).set(key[0] ?? "", value);
    return;
  }
  if (
    table[0] === "model_providers" &&
    table.length === 3 &&
    table[2] === "headers" &&
    key.length === 1 &&
    value.kind === "string"
  ) {
    headerTable(toml, table[1]).set(key[0].toLowerCase(), value.value);
  }
}

/** What one `key = value` line says; null when the line defeats the subset. */
function readEntry(line: string): { key: string[]; value: TomlValue } | null {
  const eq = line.indexOf("=");
  if (eq === -1) return null;
  const key = keyPath(line.slice(0, eq).trim());
  const value = key ? parseValue(line.slice(eq + 1)) : null;
  return key && value ? { key, value } : null;
}

/**
 * The table a `[header]` line names, and whether keys under it are ignored. An array of tables
 * (`[[…]]`) is ignored whole: every key under it belongs to one of its entries, none of it ours.
 * Null for a line that is not a table header at all.
 */
function readTableHeader(line: string): { table: string[]; ignoring: boolean } | null {
  if (line.startsWith("[[") && line.endsWith("]]")) {
    return { table: keyPath(line.slice(2, -2).trim()) ?? [], ignoring: true };
  }
  if (line.startsWith("[") && line.endsWith("]")) {
    return { table: keyPath(line.slice(1, -1).trim()) ?? [], ignoring: false };
  }
  return null;
}

/** Parse the subset: the lines the file has, the tables this module reads, and whether any line defeated it. */
function parseToml(text: string): CcswitchToml {
  const toml: CcswitchToml = { top: new Map(), providers: new Map(), headers: new Map(), malformed: false };
  let table: string[] = [];
  let ignoring = false;
  for (const raw of toLogicalLines(text)) {
    const line = stripComment(raw).trim();
    if (line === "") continue;
    const header = readTableHeader(line);
    if (header) {
      table = header.table;
      ignoring = header.ignoring;
      continue;
    }
    if (ignoring) continue;
    const entry = readEntry(line);
    if (!entry) {
      toml.malformed = true;
      continue;
    }
    place(toml, table, entry.key, entry.value);
  }
  return toml;
}

// ── reading what was parsed ───────────────────────────────────────────────────────────────────────

/** A string field's value, or null for a missing, empty or non-string one. */
function strField(value: TomlValue | undefined): string | null {
  return value?.kind === "string" && value.value !== "" ? value.value : null;
}

/** The bearer a header carries (`Bearer sk-…`), or null for any other scheme. */
function bearerOf(header: string | undefined): string | null {
  const match = header ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;
  return match ? match[1].trim() || null : null;
}

/**
 * A base URL cc-switch wrote, checked for hygiene: http(s), no credentials, no whitespace or
 * control characters (an injection), no query or fragment, trailing slash taken off. Unlike a
 * local server's address it is not checked for locality — a cc-switch provider is a hosted API
 * by design, and its path is left exactly as written.
 */
function readProviderUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const typed = value.trim();
  if (!typed || typed.length > MAX_URL_CHARS || /[\s\p{Cc}]/u.test(typed)) return null;
  let url: URL;
  try {
    url = new URL(typed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || typed.includes("?") || typed.includes("#")) return null;
  return typed.replace(/\/+$/, "");
}

/** The selected provider of a parsed file, or why there is none to run. */
function extract(
  toml: CcswitchToml,
): { kind: "none"; reason: CcswitchAbsence } | { kind: "provider"; provider: ParsedProvider } {
  if (toml.malformed) return { kind: "none", reason: CcswitchAbsence.Unreadable };
  const selected = toml.top.get("model_provider");
  if (selected === undefined) return { kind: "none", reason: CcswitchAbsence.NoProvider };
  if (selected.kind !== "string" || !BARE_KEY.test(selected.value)) {
    return { kind: "none", reason: CcswitchAbsence.Unreadable };
  }
  const id = selected.value;
  const table = toml.providers.get(id);
  if (!table) return { kind: "none", reason: CcswitchAbsence.NoProvider };
  const baseUrl = readProviderUrl(strField(table.get("base_url")));
  if (!baseUrl) return { kind: "none", reason: CcswitchAbsence.Unreadable };
  const wire = table.get("wire_api");
  let wireApi: "responses" | "chat" = "responses";
  if (wire !== undefined) {
    if (wire.kind !== "string" || (wire.value !== "responses" && wire.value !== "chat")) {
      return { kind: "none", reason: CcswitchAbsence.Unreadable };
    }
    wireApi = wire.value;
  }
  return {
    kind: "provider",
    provider: {
      id,
      name: strField(table.get("name")),
      baseUrl,
      wireApi,
      envKey: strField(table.get("env_key")),
      model: strField(toml.top.get("model")),
      bearerToken: strField(table.get("experimental_bearer_token")),
      headerKey: bearerOf(toml.headers.get(id)?.get("authorization")),
    },
  };
}

/**
 * The key, from the four places one can live, in the order the Codex CLI itself reads them: the
 * inline bearer, the variable the table names, `auth.json`'s `OPENAI_API_KEY` (where cc-switch
 * keeps a pasted key), then a header's bearer. A table that names an `env_key` names its only
 * source: a variable the environment does not have is no key at all, never a fallback to
 * another place's key.
 */
async function resolveKey(
  provider: ParsedProvider,
  codexHome: string,
  env: Record<string, string | undefined>,
): Promise<string | null> {
  if (provider.bearerToken) return provider.bearerToken;
  if (provider.envKey) {
    const fromEnv = env[provider.envKey];
    return typeof fromEnv === "string" && fromEnv !== "" ? fromEnv : null;
  }
  const auth = await readJsonIfExists<unknown>(path.join(codexHome, "auth.json")).catch(() => null);
  if (isJsonObject(auth) && typeof auth.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY !== "")
    return auth.OPENAI_API_KEY;
  return provider.headerKey;
}

/**
 * What cc-switch left in `codexHome` (`~/.codex` by default): the selected provider with its
 * key read at this moment, or why there is nothing to run. Nothing is cached — cc-switch is the
 * control plane and this is read afresh on every launch and every "Check again".
 */
export async function readCcswitchConfig(
  codexHome: string,
  env: Record<string, string | undefined> = process.env,
): Promise<CcswitchConfig> {
  let text: string;
  try {
    text = (await readRegularFile(path.join(codexHome, "config.toml"), MAX_CONFIG_BYTES)).toString("utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return { kind: "none", reason: code === "ENOENT" ? CcswitchAbsence.NoFile : CcswitchAbsence.Unreadable };
  }
  if (/[\u0000\uFFFD]/.test(text)) return { kind: "none", reason: CcswitchAbsence.Unreadable };
  const extracted = extract(parseToml(text));
  if (extracted.kind !== "provider") return extracted;
  const key = await resolveKey(extracted.provider, codexHome, env);
  if (key === null) return { kind: "none", reason: CcswitchAbsence.NoKey };
  const { bearerToken: _bearer, headerKey: _header, ...provider } = extracted.provider;
  return { kind: "provider", provider, key };
}

// ── the launch ────────────────────────────────────────────────────────────────────────────────────

/** A `-c` value as a TOML basic string: quoted, so a name with spaces stays one value. */
function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * The provider as CLI overrides, beside the engine's `--ignore-user-config`: the selection, its
 * address, its wire protocol, and the env var the key will be in. `requires_openai_auth` is
 * forced off whatever the file says — cc-switch writes it `true` for relays, and the key is
 * supplied here, so the CLI must not demand a ChatGPT login the isolated home does not have.
 */
export function ccswitchProviderArgs(provider: CcswitchProvider): string[] {
  return [
    "-c",
    `model_provider=${provider.id}`,
    "-c",
    // The CLI refuses a provider whose name is empty, and `--ignore-user-config` means this
    // override is the only place that name can come from: the file's own `name`, else the id.
    `model_providers.${provider.id}.name=${tomlString(provider.name ?? provider.id)}`,
    "-c",
    `model_providers.${provider.id}.base_url=${provider.baseUrl}`,
    "-c",
    `model_providers.${provider.id}.wire_api=${provider.wireApi}`,
    "-c",
    `model_providers.${provider.id}.env_key=${PROVIDER_KEY_ENV}`,
    "-c",
    `model_providers.${provider.id}.requires_openai_auth=false`,
  ];
}

/** The key in the child's environment, under the one name the argv spells. */
export function ccswitchLaunchEnv(key: string): Record<string, string> {
  return { [PROVIDER_KEY_ENV]: key };
}

/** The cc-switch connection mode, saved in the engine home: a preference, not a credential. */
export interface CcswitchConnectionSettings {
  read(): Promise<CodexConnection>;
  write(mode: CodexConnection): Promise<void>;
}

/**
 * The saved mode in the JSON file at `file`. A missing or unreadable file — or one holding
 * anything but the cc-switch mode — is the subscription: the default connection, never a lock.
 */
export function ccswitchConnectionSettings(file: string): CcswitchConnectionSettings {
  return {
    read: async () => {
      const value = await readJsonIfExists<unknown>(file).catch(() => null);
      return isJsonObject(value) && value.mode === CodexConnection.Ccswitch
        ? CodexConnection.Ccswitch
        : CodexConnection.Subscription;
    },
    write: (mode) => atomicWriteJson(file, { mode }),
  };
}

// ── discovery ─────────────────────────────────────────────────────────────────────────────────────

/**
 * The provider's models, as picker rows: its OpenAI-compatible `/models` when it answers one,
 * else the model the file left selected as the single row. A provider that refuses a key, or
 * answers with something that is not a model list, has no rows — the engine reports the
 * refusal, and a picker must not offer a model the launch would fail on.
 */
export async function ccswitchModels(
  provider: CcswitchProvider,
  key: string | null,
  timeoutMs = DISCOVERY_TIMEOUT_MS,
): Promise<EngineModel[]> {
  const access = { url: provider.baseUrl, key };
  const list = await readModelList(access, timeoutMs);
  if (list.answer === ListAnswer.Models) {
    const rows = await serverModels(access, null, list.entries);
    if (rows.length > 0) return rows;
  }
  if (list.answer === ListAnswer.NeedsKey || list.answer === ListAnswer.NotOpenAi) return [];
  return provider.model ? [modelRow(provider.model)] : [];
}

/** The facts a listed model carries, re-exported for the row the config model becomes. */
export type { ModelFacts };
