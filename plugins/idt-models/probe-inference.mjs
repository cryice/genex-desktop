/**
 * Which request shape the one shared route actually accepts.
 *
 * `POST /v1/flexible/infers` unpacks `args` into the model's `infer` (`infer(*args, **kwargs)`). A body
 * that carries the payload anywhere else leaves `args` as `None` and dies inside the actor:
 *
 *   <xoscar.core.ActorRefMethod object at 0x…> argument after * must be an iterable, not NoneType
 *
 * That reads like an unimplemented route, so this script settles it by experiment instead. It sends a
 * matrix of candidate shapes and, after each one, reads the model's own event log. A shape that
 * reached a launcher leaves the launcher's words there ("… requires one of: 'text' …"); a shape that
 * died in the actor leaves the actor's. The control is the same request against a uid that does not
 * exist: a route that validates answers 404 naming the available uids.
 *
 * Every candidate payload is empty on purpose, so a launcher refuses it and nothing is generated — no
 * GPU time is spent. For the same reason this is safe to run against a busy server.
 *
 *   IDT_API_KEY=... node plugins/idt-models/probe-inference.mjs
 *   IDT_API_KEY=... node plugins/idt-models/probe-inference.mjs trellis2-4b
 *   IDT_MODEL=hunyuan3d-2.1 IDT_BASE_URL=http://10.108.15.66:9997 IDT_API_KEY=... node plugins/idt-models/probe-inference.mjs
 */

const base = (process.env.IDT_BASE_URL ?? "http://10.108.15.66:9997").replace(/\/+$/, "").replace(/\/v1$/, "");
const key = process.env.IDT_API_KEY ?? "";
const model = process.argv[2] ?? process.env.IDT_MODEL ?? "hunyuan3d-2.1";
const headers = { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) };
const url = `${base}/v1/flexible/infers`;

/** The newest line in the model's event log, which is where a launcher's own words turn up. */
async function newestEvent(uid) {
  try {
    const answer = await fetch(`${base}/v1/models/${uid}/events`, { headers, signal: AbortSignal.timeout(15_000) });
    if (!answer.ok) return null;
    const events = await answer.json();
    const last = Array.isArray(events) ? events.at(-1) : null;
    return last ? { ts: last.event_ts, text: String(last.event_content).replace(/\s+/g, " ") } : null;
  } catch {
    return null;
  }
}

const CANDIDATES = [
  ["(no payload at all)", { model }],
  ["parameters: {}", { model, parameters: {} }],
  ["parameters: []", { model, parameters: [] }],
  ["parameters: [{}]", { model, parameters: [{}] }],
  ["kwargs: {}", { model, kwargs: {} }],
  ["args: []", { model, args: [] }],
  ["args: [{}]", { model, args: [{}] }],
  ["args: [{}, {}]", { model, args: [{}, {}] }],
  ["task: image_to_3d", { model, task: "image_to_3d" }],
  ["input: {}", { model, input: {} }],
  ["payload: {}", { model, payload: {} }],
  ["-- a uid that does not exist (control)", { model: "no-such-model-xyz", args: [{}] }],
];

console.log(`POST ${url}\nmodel ${model}\n`);
let reached = 0;
for (const [label, body] of CANDIDATES) {
  const before = await newestEvent(model);
  let status = 0;
  let said = "";
  try {
    const answer = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    status = answer.status;
    const text = await answer.text();
    let detail = text;
    try {
      detail = JSON.parse(text)?.detail ?? text;
    } catch {
      // not JSON: quote the text
    }
    said = String(detail).replace(/\s+/g, " ").slice(0, 160);
  } catch (error) {
    said = `nothing answered (${error?.message ?? error})`;
  }
  await new Promise((resolve) => setTimeout(resolve, 700));
  const after = await newestEvent(model);
  const isNew = before === null || after === null ? null : after.ts !== before.ts;
  const atLauncher = /^\[address=/.test(said);
  if (atLauncher) reached += 1;
  console.log(`${atLauncher ? "LAUNCHER" : "actor   "}  ${label}`);
  console.log(`          HTTP ${status}  ${said}`);
  if (isNew && !said.includes(after.text.slice(0, 40))) console.log(`          event:  ${after.text.slice(0, 140)}`);
}

console.log(
  reached > 0
    ? `\n${reached} of ${CANDIDATES.length} shapes reached a model launcher. The ones marked LAUNCHER carry the payload the route accepts — "args: [<payload>]" is the shape this plugin sends.`
    : `\nNo shape reached a launcher: the route itself is not dispatching to a model. That is a server-side problem, worth reporting with this output.`,
);
