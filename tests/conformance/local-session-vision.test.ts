/**
 * A studio session on a model that cannot see images is told the pictures exist, and is handed no
 * pixels (local-session.ts `messagesWithoutPictures`, `addRoundImages`).
 *
 * Seen on a real build: a worker on `deepseek-v4-pro` (which states no vision) took a screenshot
 * with its capture tool, the round's picture went into `read_file`-shaped history, and from then
 * on every completion of that session was refused by its own engine — "this model cannot see
 * images" — before it reached the provider. A resumed session could never run again, and the run
 * around it read as a provider that had gone away.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { LocalSessions } from "../../src/substrate/engines/local-session.ts";
import type {
  CompleteRequest,
  CompleteResponse,
  DelegateRequest,
  DelegateResult,
} from "../../src/substrate/engines/types.ts";

/** The id the session runs on; whether it sees is the engine's own answer, as it is in production. */
const MODEL = "one-model";
/** A one-pixel PNG, so `read_file` answers with a picture the way a capture tool would. */
const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

/** How many pictures a request carries, over every message. */
const pictures = (request: CompleteRequest | undefined): number =>
  (request?.messages ?? []).reduce((count, message) => count + (message.images?.length ?? 0), 0);
/** Everything a request's messages say, as one string. */
const said = (request: CompleteRequest | undefined): string =>
  (request?.messages ?? []).map((message) => String(message.content)).join("\n");

describe("a session on a model that cannot see images", () => {
  let root: string;
  before(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "session-vision-"));
  });
  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /**
   * Run one session whose model calls `read_file` on a picture and then answers, and answer with
   * every request it sent. `sees` is what the engine says about the model.
   */
  async function run(sees: boolean): Promise<{ requests: CompleteRequest[]; result: DelegateResult }> {
    const cwd = await mkdtemp(path.join(root, "game-"));
    await mkdir(cwd, { recursive: true });
    await writeFile(path.join(cwd, "shot.png"), Buffer.from(PIXEL, "base64"));
    const requests: CompleteRequest[] = [];
    const sessions = new LocalSessions({
      root: path.join(root, "sessions"),
      scratchRoot: path.join(root, "scratch"),
      protectedPaths: [path.join(root, "sessions")],
      contextWindow: 100_000,
      seesImages: () => sees,
      complete: async (request): Promise<CompleteResponse> => {
        // A snapshot: the session keeps growing the array it hands the engine round to round.
        requests.push({ ...request, messages: request.messages.map((message) => ({ ...message })) });
        const looking = requests.length === 1;
        return {
          message: looking
            ? {
                role: "assistant",
                content: "",
                tool_calls: [{ id: "c1", name: "read_file", arguments: { path: "shot.png" } }],
              }
            : { role: "assistant", content: "Done." },
          usage: { input_tokens: 1, output_tokens: 1 },
          stopReason: "stop",
          model: MODEL,
          engine: "test",
        };
      },
    });
    const request: DelegateRequest = { cwd, prompt: "Look at the screenshot, then finish." };
    return { requests, result: await sessions.run(request, MODEL) };
  }

  it("hands it no pixels, says the pictures exist, and a model that sees still gets them", async () => {
    const blind = await run(false);
    assert.deepEqual(
      blind.requests.map(pictures),
      [0, 0],
      "no request of the session carries a picture a model cannot see",
    );
    assert.match(said(blind.requests[1]), /cannot see images/, "and the model is told why");
    assert.equal(blind.result.ok, true, "the session runs to its end");

    const seeing = await run(true);
    assert.deepEqual(seeing.requests.map(pictures), [0, 1], "a model that sees is handed the picture the round took");
  });

  it("sends no pixels from a history that already holds one, so a resumed session runs again", async () => {
    const cwd = await mkdtemp(path.join(root, "game-"));
    await mkdir(cwd, { recursive: true });
    const id = "0f4b7c1e-0000-4000-8000-00000000beef";
    const sessions = path.join(root, "sessions");
    await mkdir(sessions, { recursive: true });
    // A session saved by a build that had pictures in it: the screenshot is in the file, where no
    // engine can be asked about it — which is how a resumed session used to die on its first round.
    await writeFile(
      path.join(sessions, `${id}.json`),
      JSON.stringify({
        version: 1,
        cwd: await realpath(cwd),
        model: MODEL,
        messages: [
          { role: "user", content: "Build the room." },
          {
            role: "user",
            content: "Images returned by the preceding tools",
            images: [{ mimeType: "image/jpeg", data: PIXEL }],
          },
        ],
      }),
    );
    const requests: CompleteRequest[] = [];
    const local = new LocalSessions({
      root: sessions,
      scratchRoot: path.join(root, "scratch"),
      protectedPaths: [sessions],
      contextWindow: 100_000,
      seesImages: () => false,
      complete: async (request) => {
        requests.push({ ...request, messages: request.messages.map((message) => ({ ...message })) });
        return {
          message: { role: "assistant", content: "Done." },
          usage: { input_tokens: 1, output_tokens: 1 },
          stopReason: "stop",
          model: MODEL,
          engine: "test",
        };
      },
    });
    const result = await local.run({ cwd, prompt: "Carry on.", resume: id }, MODEL);
    assert.equal(result.ok, true, "the resumed session runs");
    assert.equal(pictures(requests[0]), 0, "the stored screenshot is not sent");
    assert.match(said(requests[0]), /cannot see images/, "and the session hears it was left behind");
  });
});
