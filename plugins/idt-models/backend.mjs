/**
 * The IDT intranet GPU models as Genex tools.
 *
 * WHY A PLUGIN AND NOT AN ENGINE. The Xinference at 10.108.15.66:9997 serves four `flexible` models
 * and no language model at all, so it can never drive a Genex session. A plugin tool can call it,
 * though, and `assets.deliver` puts what comes back into the game's own assets, where the Assets tab
 * previews it.
 *
 * WHY THIS BACKEND MAY CALL THE INTRANET. Studio does not sandbox a plugin backend: it is trusted
 * executable code, which is what `network.hosts` in `plugin.json` discloses at install. A managed
 * native job could not do this — its sandbox denies network — so nothing here is a `nativeJobs`
 * entry.
 *
 * HOW A GENERATION IS ASKED FOR. One route serves every model, and it takes one shape:
 *
 *   POST {base}/v1/flexible/infers
 *   {"model": "<model_uid>", "args": [ <that model's own keyword payload> ]}
 *
 * `args` has to be there, and has to be a list. The route unpacks it into the model's `infer`
 * (`infer(*args, **kwargs)`), so a body that carries the payload anywhere else — `parameters`,
 * `kwargs`, or flat — leaves `args` as None and dies inside the actor with
 *
 *   <xoscar.core.ActorRefMethod object at 0x…> argument after * must be an iterable, not NoneType
 *
 * before any model is reached. That failure reads like a route with no implementation, and this
 * plugin first mistook it for one; `probe-inference.mjs` settles it in one command. With `args` in
 * place every launcher answers in its own words — Hunyuan3D says "requires one of: 'text' (prompt
 * string), 'image' (base64)…" — which is also what `status` uses to prove the route reaches a
 * launcher rather than merely being registered.
 *
 * WHAT EACH MODEL ANSWERS, all four measured through that one route on 2026-10-14:
 *
 *   hunyuan3d-2.1    {image} | {text} | {mv_image_*}  → {model_base64: GLB, obj_base64, texture_image_base64, metallic_base64, roughness_base64, stats}  200, ~56 s
 *   trellis2-4b      {image}                          → {model_base64: GLB}                                                                          200, ~120 s
 *   flux-2-klein-4b  {prompt}                         → {image, image_base64: PNG}                                                                   200, ~12 s
 *   qwen-image-edit  {prompt, image}                  → {image, image_base64: PNG}
 *   segmentation     POST 10.108.15.66:18092/v1/segment → a job; it wants a platform token, not a launcher
 *
 * The 3D launchers take a picture as base64, with or without a `data:` prefix (probed with a
 * non-image: both forms fail identically, so the prefix is normalised before decoding).
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** How long a generation request may take. TRELLIS.2 answered a real one in about 120 s. */
const GENERATE_TIMEOUT_MS = 20 * 60_000;
/** How long a plain read (a model list, a health probe) may take. */
const READ_TIMEOUT_MS = 20_000;
/** The largest answer read into memory; a base64 GLB is a third larger than the GLB itself. */
const MAX_ANSWER_BYTES = 140 * 1024 * 1024;
/** The largest generated file delivered into the game. */
const MAX_ASSET_BYTES = 100 * 1024 * 1024;
/** The largest picture this plugin reads out of the game and sends on. */
const MAX_INPUT_BYTES = 24 * 1024 * 1024;
/** How long each wait for a segmentation job, and how many. */
const JOB_POLL_MS = 3_000;
const JOB_POLL_TRIES = 100;
/** The asset name rule, the same one Local Blender uses. */
const ASSET_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** A picture's extension to the MIME type reported for it. */
const PICTURE_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** The 3D models and the tasks each one's own launcher accepts. The first is the default. */
const MODELS_3D = {
  "hunyuan3d-2.1": { extension: "glb", tasks: ["image_to_3d", "text_to_3d", "multiview_to_3d"] },
  "trellis2-4b": { extension: "glb", tasks: ["image_to_3d"] },
};

/** The two picture models: one shared editing service, chosen by whether a picture came with it. */
const MODEL_EDIT = "qwen-image-edit";
const MODEL_DRAW = "flux-2-klein-4b";

/** What this plugin says to the agent. */
const MESSAGE = {
  NoProject: "No game is bound to this call, so there is nowhere to deliver an asset.",
  BadName: "An asset name is letters, digits and dashes, at most 40 characters.",
  BadModel: (model, known) => `Unknown model ${model}. Use one of: ${known}.`,
  BadTask: (task, model, known) => `${model} does not do ${task}. It does: ${known}.`,
  NeedsImage: "Give a picture of this game, relative to the game folder.",
  NeedsPrompt: "A text-to-3D call needs a prompt.",
  NeedsViews: "Multiview-to-3D needs four pictures, front, back, left and right, in that order.",
  ImageOutside: (file) => `A picture must be a file inside this game, not ${file}.`,
  ImageMissing: (file) => `No such picture in this game: ${file}.`,
  ImageTooLarge: (limit) => `That picture is larger than ${limit} bytes.`,
  ImageType: (file) => `${file} is not a PNG, JPEG, WebP or GIF.`,
  NoAnswer: (where) => `Nothing answered at ${where}.`,
  HttpFailed: (url, status, body) => `${url} answered HTTP ${status}: ${body}`,
  NoOutput: (raw) => `The server answered without a generated file. Its answer was: ${raw}`,
  TooBig: (limit) => `The generated file is larger than ${limit} bytes; simplify the request.`,
  NotJsonBody: "raw-infer needs the whole request body as JSON text.",
  SegmentToken:
    "The segmentation service needs a platform user token and answered MODEL_LOGIN_EXPIRED. Put one in this plugin's 'segment-token' setting.",
  SegmentFailed: (detail) => `Segmentation did not finish: ${detail}`,
};

/** The settings, with the address and the role of each. Keys are hyphen-case, as a manifest requires. */
const DEFAULT_SETTINGS = {
  "base-url": "http://10.108.15.66:9997",
  "api-key": "",
  "segment-url": "http://10.108.15.66:18092",
  "segment-token": "",
  "gpu-url": "http://10.108.15.66:18091",
};

/** The origin of a saved address: no trailing slash, no trailing `/v1` (each route adds its own). */
function originOf(url) {
  return String(url ?? "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/v1$/, "");
}

/** The settings as this call sees them: every one typed by the person, else its default. */
async function settingsOf(ctx) {
  const saved = { ...DEFAULT_SETTINGS, ...((await ctx.host("settings.read").catch(() => null)) ?? {}) };
  const text = (key) => (typeof saved[key] === "string" ? saved[key].trim() : DEFAULT_SETTINGS[key]);
  return {
    origin: originOf(text("base-url")),
    key: text("api-key"),
    segment: originOf(text("segment-url")),
    segmentToken: text("segment-token"),
    gpu: originOf(text("gpu-url")),
  };
}

/**
 * One request, answered as bytes and a content type. The body is read with a cap so a misbehaving
 * server cannot fill memory, and a refusal is returned rather than thrown so callers can quote it.
 */
async function fetchBytes(url, options = {}) {
  const { method = "GET", body, headers = {}, timeoutMs = READ_TIMEOUT_MS } = options;
  let response;
  try {
    response = await fetch(url, {
      method,
      redirect: "error",
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(MESSAGE.NoAnswer(`${url} (${error?.message ?? error})`));
  }
  const declared = Number(response.headers.get("content-length") ?? Number.NaN);
  if (declared > MAX_ANSWER_BYTES) throw new Error(MESSAGE.TooBig(MAX_ANSWER_BYTES));
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_ANSWER_BYTES) throw new Error(MESSAGE.TooBig(MAX_ANSWER_BYTES));
  return { ok: response.ok, status: response.status, contentType: response.headers.get("content-type") ?? "", bytes };
}

/** The same request, read as JSON where it is JSON, with the refusal's words kept as text. */
async function fetchJson(url, options = {}) {
  const answer = await fetchBytes(url, options);
  const text = answer.bytes.toString("utf8");
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { ...answer, text, json };
}

/** The Bearer header for a token, or nothing. */
const bearer = (token) => (token ? { authorization: `Bearer ${token}` } : {});

/** What a refusal says, whether it is wrapped in JSON or plain. */
function saidOf(answer) {
  const detail = answer.json?.detail;
  return String(detail ?? answer.text ?? "").trim();
}

/**
 * One generation, through the one route every model shares. The payload goes inside `args`, which is
 * the whole point: see the note at the top of this file.
 */
async function infer(settings, model, payload, timeoutMs = GENERATE_TIMEOUT_MS, headers = {}) {
  const url = `${settings.origin}/v1/flexible/infers`;
  const answer = await fetchJson(url, {
    method: "POST",
    body: { model, args: [payload] },
    headers: { ...bearer(settings.key), ...headers },
    timeoutMs,
  });
  if (!answer.ok) throw new Error(MESSAGE.HttpFailed(url, answer.status, saidOf(answer).slice(0, 600)));
  return answer;
}

/** The asset name as a slug, the same rule Local Blender applies. */
function assetSlug(name) {
  const slug = String(name ?? "")
    .trim()
    .replace(/[A-Z]/g, (letter) => letter.toLowerCase())
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  if (!ASSET_NAME.test(slug)) throw new Error(MESSAGE.BadName);
  return slug;
}

/** Which of `known` the argument names, or the first as its default. */
function pickModel(given, known) {
  const names = Object.keys(known);
  const name = String(given ?? "").trim() || names[0];
  if (!Object.hasOwn(known, name)) throw new Error(MESSAGE.BadModel(name, names.join(", ")));
  return name;
}

/** A picture of this game, read as bytes and sent on as base64. */
async function readPicture(ctx, relative) {
  if (!ctx.directory) throw new Error(MESSAGE.NoProject);
  const given = String(relative ?? "").trim();
  if (!given) throw new Error(MESSAGE.NeedsImage);
  if (path.isAbsolute(given) || given.split(/[\\/]/).includes("..")) throw new Error(MESSAGE.ImageOutside(given));
  const file = path.join(ctx.directory, given);
  const bytes = await readFile(file).catch(() => {
    throw new Error(MESSAGE.ImageMissing(given));
  });
  if (bytes.byteLength > MAX_INPUT_BYTES) throw new Error(MESSAGE.ImageTooLarge(MAX_INPUT_BYTES));
  const type = PICTURE_TYPES[path.extname(file).toLowerCase()];
  if (!type) throw new Error(MESSAGE.ImageType(given));
  const base64 = bytes.toString("base64");
  return { base64, dataUrl: `data:${type};base64,${base64}`, bytes: bytes.byteLength };
}

/** A directory of this plugin's own storage for one delivery; `assets.deliver` only copies from there. */
async function outputDir(ctx, jobId) {
  const root = await ctx.host("storage.root");
  const dir = path.join(root, "out", jobId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Bytes written into this plugin's storage, ready for `assets.deliver`. */
async function saveBytes(ctx, jobId, name, extension, bytes) {
  if (bytes.byteLength > MAX_ASSET_BYTES) throw new Error(MESSAGE.TooBig(MAX_ASSET_BYTES));
  const dir = await outputDir(ctx, jobId);
  await writeFile(path.join(dir, `${name}.${extension}`), bytes);
  return dir;
}

/** Copy what was saved into the game's own assets and report the project-relative paths. */
const deliver = (ctx, dir, jobId) => ctx.host("assets.deliver", { output: dir, jobId });

/** One delivered asset: where it landed and what it was. */
const delivered = (jobId, model, files, extra = {}) => ({
  jobId,
  model,
  files: files.length === 1 ? files[0] : files,
  ...extra,
});

/** The base64 out of a value that may be a `data:` URL. */
const withoutDataUrl = (value) => {
  const at = value.indexOf(";base64,");
  return at === -1 ? value : value.slice(at + 8);
};

/** The fields a service puts one generated picture in, when it does not send the bytes themselves. */
const PICTURE_FIELDS = new Set(["image", "image_base64", "base64"]);

/** A field name as an asset name: `image_base64` is `image-base64` is `image-base64`. */
const fieldSlug = (field) =>
  String(field)
    .replace(/[^a-z0-9-]/gi, "-")
    .toLowerCase()
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "image";

/**
 * Every distinct picture in an answer. One model answers one picture under two names (`image` and
 * `image_base64`, the same bytes); the editing model answers its four views (`front`, `left`, `top`,
 * `perspective`). Identical bytes are kept once, so the shape of the answer decides what is delivered
 * rather than a guess at which field is the real one.
 */
function picturesOf(answer) {
  if (answer.contentType.startsWith("image/")) return [{ field: "image", bytes: answer.bytes }];
  const seen = new Set();
  const pictures = [];
  for (const [field, value] of Object.entries(answer.json ?? {})) {
    if (typeof value !== "string" || value.length < 64) continue;
    if (!value.startsWith("data:image/") && !PICTURE_FIELDS.has(field)) continue;
    const bytes = Buffer.from(withoutDataUrl(value), "base64");
    if (!bytes.byteLength) continue;
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (seen.has(digest)) continue;
    seen.add(digest);
    pictures.push({ field, bytes });
  }
  return pictures;
}

/** The generated bytes in an answer: the bytes themselves, or the base64 a service wraps them in. */
function bytesOfAnswer(answer) {
  if (answer.contentType.startsWith("image/") || answer.contentType.startsWith("model/")) return answer.bytes;
  for (const field of ["model_base64", "image_base64", "base64"]) {
    const value = answer.json?.[field];
    if (typeof value === "string" && value) return Buffer.from(withoutDataUrl(value), "base64");
  }
  if (answer.json) return null;
  const text = answer.text ?? answer.bytes.toString("utf8");
  if (text.startsWith("data:")) return Buffer.from(withoutDataUrl(text), "base64");
  return null;
}

/** The payload a 3D launcher wants for the task being asked of it. */
async function payload3d(ctx, task, args) {
  if (task === "text_to_3d") {
    const text = String(args.prompt ?? "").trim();
    if (!text) throw new Error(MESSAGE.NeedsPrompt);
    return { text };
  }
  if (task === "multiview_to_3d") {
    const views = String(args.views ?? "")
      .split(",")
      .map((one) => one.trim())
      .filter(Boolean);
    if (views.length !== 4) throw new Error(MESSAGE.NeedsViews);
    const [front, back, left, right] = await Promise.all(views.map((one) => readPicture(ctx, one)));
    return {
      mv_image_front: front.base64,
      mv_image_back: back.base64,
      mv_image_left: left.base64,
      mv_image_right: right.base64,
    };
  }
  return { image: (await readPicture(ctx, args.image)).base64 };
}

/** Generate a 3D model on the intranet and deliver the GLB. */
async function model3d(args, ctx) {
  const settings = await settingsOf(ctx);
  const name = assetSlug(args.name);
  const model = pickModel(args.model, MODELS_3D);
  const known = MODELS_3D[model];
  const asked = String(args.task ?? "").trim();
  const task = asked || (args.views ? "multiview_to_3d" : args.prompt && !args.image ? "text_to_3d" : "image_to_3d");
  if (!known.tasks.includes(task)) throw new Error(MESSAGE.BadTask(task, model, known.tasks.join(", ")));
  const answer = await infer(settings, model, await payload3d(ctx, task, args));
  const bytes = bytesOfAnswer(answer);
  if (!bytes) throw new Error(MESSAGE.NoOutput(answer.text.slice(0, 600)));
  const jobId = randomUUID();
  const files = await deliver(ctx, await saveBytes(ctx, jobId, name, known.extension, bytes), jobId);
  return delivered(jobId, model, files, {
    task,
    bytes: bytes.byteLength,
    // What the server said about its own work, so a report can quote it rather than guess.
    seconds: answer.json?.time_seconds ?? null,
    textured: answer.json?.has_texture ?? null,
  });
}

/** Generate or edit a picture on the intranet and deliver it — or, for an edit, its four views. */
async function image(args, ctx) {
  const settings = await settingsOf(ctx);
  const name = assetSlug(args.name);
  const prompt = String(args.prompt ?? "").trim();
  const payload = { prompt };
  if (args.image) payload.image = (await readPicture(ctx, args.image)).base64;
  // The model is the uid of the launcher that does this: one shared editing service behind both.
  const model = payload.image ? MODEL_EDIT : MODEL_DRAW;
  const answer = await infer(settings, model, payload);
  const pictures = picturesOf(answer);
  if (!pictures.length) throw new Error(MESSAGE.NoOutput(withoutDataUrl(answer.text).slice(0, 600)));
  const jobId = randomUUID();
  const dir = await outputDir(ctx, jobId);
  let bytes = 0;
  for (const picture of pictures) {
    // One picture keeps the plain name; the editing model's several views are told apart by field.
    await saveBytes(
      ctx,
      jobId,
      pictures.length === 1 ? name : `${name}-${fieldSlug(picture.field)}`,
      "png",
      picture.bytes,
    );
    bytes += picture.bytes.byteLength;
  }
  return delivered(jobId, model, await deliver(ctx, dir, jobId), {
    bytes,
    views: pictures.map((one) => one.field),
  });
}

/** The job id, whichever name a service gives it. */
function jobIdOf(json) {
  for (const field of ["job_id", "jobId", "id", "task_id"]) if (typeof json?.[field] === "string") return json[field];
  return null;
}

/** The picture names a job reports, wherever in its answer it keeps them. */
function fileNamesOf(json) {
  const names = new Set();
  const walk = (value, depth = 0) => {
    if (depth > 5 || value === null || typeof value !== "object") return;
    for (const item of Object.values(value)) {
      if (typeof item === "string" && /\.(png|jpe?g|webp)$/i.test(item) && !item.startsWith("data:")) names.add(item);
      else walk(item, depth + 1);
    }
  };
  walk(json);
  return [...names];
}

/** Wait for a segmentation job and answer the pictures it produced. */
async function awaitJob(base, jobId, token) {
  for (let attempt = 0; attempt < JOB_POLL_TRIES; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_MS));
    const url = `${base}/v1/jobs/${jobId}`;
    const answer = await fetchJson(url, { headers: bearer(token) });
    if (!answer.ok) throw new Error(MESSAGE.HttpFailed(url, answer.status, saidOf(answer).slice(0, 400)));
    const state = String(answer.json?.status ?? answer.json?.state ?? "");
    if (/fail|error/i.test(state)) throw new Error(MESSAGE.SegmentFailed(saidOf(answer).slice(0, 400)));
    const names = fileNamesOf(answer.json);
    const finished = /done|succeed|complete|ready|finish/i.test(state) || (!state && names.length > 0);
    if (names.length && finished) return names;
  }
  throw new Error(MESSAGE.SegmentFailed("the job did not finish in time"));
}

/** Cut the objects out of one picture of this game, one image per object. */
async function segment(args, ctx) {
  const settings = await settingsOf(ctx);
  const name = assetSlug(args.name);
  const picture = await readPicture(ctx, args.image);
  const body = { image: picture.dataUrl };
  if (args.prompt) body.prompt = String(args.prompt);
  const started = await fetchJson(`${settings.segment}/v1/segment`, {
    method: "POST",
    body,
    headers: bearer(settings.segmentToken),
    timeoutMs: GENERATE_TIMEOUT_MS,
  });
  if (started.status === 401 || /MODEL_LOGIN_EXPIRED/.test(started.text)) throw new Error(MESSAGE.SegmentToken);
  if (!started.ok)
    throw new Error(
      MESSAGE.HttpFailed(`${settings.segment}/v1/segment`, started.status, saidOf(started).slice(0, 400)),
    );
  const jobId = jobIdOf(started.json);
  if (!jobId) throw new Error(MESSAGE.NoOutput(started.text.slice(0, 400)));
  const names = await awaitJob(settings.segment, jobId, settings.segmentToken);
  const job = randomUUID();
  const dir = await outputDir(ctx, job);
  let cut = 0;
  for (const fileName of names) {
    const file = await fetchBytes(`${settings.segment}/v1/jobs/${jobId}/files/${encodeURIComponent(fileName)}`, {
      headers: bearer(settings.segmentToken),
    });
    if (!file.ok) continue;
    cut += 1;
    await saveBytes(ctx, job, `${name}-${cut}`, (path.extname(fileName).slice(1) || "png").toLowerCase(), file.bytes);
  }
  if (!cut) throw new Error(MESSAGE.NoOutput("the job reported no pictures"));
  return delivered(job, "segment", await deliver(ctx, dir, job), { objects: cut, job: jobId });
}

/**
 * Whether the shared route reaches a model at all, asked of a 3D model with an empty payload. Every
 * 3D launcher refuses an empty payload in its own words, so this costs no GPU time and separates
 * "the route works and the model answered" from "the request died in the actor before any model".
 */
async function routeLiveness(settings, models) {
  const uid = models.find((model) => Object.hasOwn(MODELS_3D, model.uid))?.uid;
  if (!uid) return { model: null, note: "no 3D model is loaded, so the route was not tried" };
  const answer = await fetchJson(`${settings.origin}/v1/flexible/infers`, {
    method: "POST",
    body: { model: uid, args: [{}] },
    headers: bearer(settings.key),
    timeoutMs: READ_TIMEOUT_MS,
  });
  const said = saidOf(answer);
  return {
    model: uid,
    status: answer.status,
    // A launcher's answer starts with its own address; an actor failure names the actor instead.
    reachesLauncher: said.startsWith("[address="),
    said: said.slice(0, 300),
  };
}

/** The intranet servers as they stand: what is loaded, and whether the one route reaches a model. */
async function status(ctx) {
  const settings = await settingsOf(ctx);
  const listing = await fetchJson(`${settings.origin}/v1/models`, { headers: bearer(settings.key) });
  if (!listing.ok) return { reachable: false, problem: saidOf(listing).slice(0, 400), address: settings.origin };
  const models = (listing.json?.data ?? []).map((entry) => ({
    uid: String(entry?.id ?? ""),
    type: String(entry?.model_type ?? "unknown"),
    // What this plugin would ask of it, so a caller can pick without guessing.
    tasks:
      MODELS_3D[entry?.id]?.tasks ??
      (entry?.id === MODEL_DRAW ? ["text_to_image"] : entry?.id === MODEL_EDIT ? ["image_edit"] : "unknown"),
  }));
  const segmentHealth = await fetchJson(`${settings.segment}/health`);
  const segmentCaps = await fetchJson(`${settings.segment}/v1/capabilities`);
  return {
    reachable: true,
    address: settings.origin,
    models,
    chatModels: 0,
    flexibleRoute: await routeLiveness(settings, models),
    segment: segmentHealth.json ?? saidOf(segmentHealth).slice(0, 200),
    segmentNeedsToken: /platform_user/.test(segmentCaps.text),
    gpu: (await fetchJson(`${settings.gpu}/gpu/status`)).json ?? "not answered",
  };
}

/** POST a hand-written body to the shared route and answer the raw reply. */
async function rawInfer(args, ctx) {
  const settings = await settingsOf(ctx);
  let body;
  try {
    body = JSON.parse(String(args.body ?? ""));
  } catch {
    throw new Error(MESSAGE.NotJsonBody);
  }
  const url = `${settings.origin}/v1/flexible/infers`;
  const answer = await fetchJson(url, {
    method: "POST",
    body,
    headers: bearer(settings.key),
    timeoutMs: GENERATE_TIMEOUT_MS,
  });
  return {
    url,
    status: answer.status,
    digest: createHash("sha256").update(answer.text).digest("hex").slice(0, 16),
    body: answer.text.slice(0, 4_000),
  };
}

export async function activate() {
  return {
    async tool(name, args, ctx) {
      if (name === "status") return status(ctx);
      if (name === "model3d") return model3d(args, ctx);
      if (name === "image") return image(args, ctx);
      if (name === "segment") return segment(args, ctx);
      if (name === "raw-infer") return rawInfer(args, ctx);
      throw new Error(`Unknown tool: ${name}`);
    },
  };
}
