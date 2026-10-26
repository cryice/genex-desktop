/**
 * A one-command check of this plugin's own code path against the live intranet servers.
 *
 * It loads `backend.mjs` exactly as Studio does, stands in for the host services, and runs a tool —
 * so a good answer here means the settings, the routes, the request bodies, the file handling and the
 * delivery all work before Studio is involved at all.
 *
 *   node plugins/idt-models/check.mjs                                   # status: reads, generates nothing
 *   IDT_API_KEY=... node plugins/idt-models/check.mjs                    # or let Settings hold the key
 *   node plugins/idt-models/check.mjs image name=cube prompt="a red cube" # really generates, ~1 s
 *
 * A tool that names a picture (`model3d`, `segment`) reads it from the stand-in game folder; a file
 * that exists in the working directory is copied in first, so `image=concept.png` works from here.
 */
import { cp, mkdir, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { activate } from "./backend.mjs";

const [tool = "status", ...pairs] = process.argv.slice(2);
const args = Object.fromEntries(
  pairs.map((pair) => {
    const at = pair.indexOf("=");
    return at === -1 ? [pair, true] : [pair.slice(0, at), pair.slice(at + 1)];
  }),
);

const settings = {
  "base-url": process.env.IDT_BASE_URL ?? "http://10.108.15.66:9997",
  "api-key": process.env.IDT_API_KEY ?? "",
  "segment-url": process.env.IDT_SEGMENT_URL ?? "http://10.108.15.66:18092",
  "segment-token": process.env.IDT_SEGMENT_TOKEN ?? "",
  "gpu-url": process.env.IDT_GPU_URL ?? "http://10.108.15.66:18091",
};

/** A stand-in game folder and plugin storage, so a delivery can be seen to happen. */
const game = await mkdtemp(path.join(tmpdir(), "idt-game-"));
const storage = await mkdtemp(path.join(tmpdir(), "idt-storage-"));
await mkdir(path.join(game, "assets"), { recursive: true });

/** A named picture is staged into the stand-in game folder if it is not there already. */
for (const key of ["image"]) {
  const named = typeof args[key] === "string" ? args[key] : "";
  if (!named || path.isAbsolute(named)) continue;
  const target = path.join(game, named);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(named, target).catch(() => {});
}

/** The host services these tools ask for, answered the way Studio answers them. */
const host = async (method, payload) => {
  if (method === "settings.read") return settings;
  if (method === "storage.root") return storage;
  // Studio copies the plugin's output into the game and records it; this shows where it landed.
  if (method === "assets.deliver") {
    const target = path.join(game, "assets", "idt-models", payload.jobId);
    await cp(payload.output, target, { recursive: true });
    const names = await readdir(target);
    return names.map((name) => path.posix.join("assets", "idt-models", payload.jobId, name));
  }
  throw new Error(`this check does not stand in for ${method}`);
};

const plugin = await activate({ call: host });
const ctx = { host, directory: game, project: "checked", signal: AbortSignal.timeout(600_000), callId: 1 };

try {
  const answer = await plugin.tool(tool, args, ctx);
  console.log(JSON.stringify(answer, null, 2));
  if (tool === "status" && answer.reachable === false) {
    console.error(`\nNot reachable: ${answer.problem}`);
    process.exitCode = 1;
  }
  if (tool === "image" || tool === "model3d") {
    const delivered = Array.isArray(answer.files) ? answer.files[0] : answer.files;
    const bytes = await readFile(path.join(game, delivered)).catch(() => null);
    console.log(`\nDelivered into the stand-in game: ${delivered}${bytes ? ` (${bytes.byteLength} bytes)` : ""}`);
  }
} catch (error) {
  console.error(`Failed: ${error?.message ?? error}`);
  process.exitCode = 1;
}
