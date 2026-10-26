/**
 * A studio session's one-turn reply budget follows the model it runs on, and a reply the output
 * limit cut short is never the whole session's failure (local-session.ts `completionRequest`,
 * `#repairTruncatedReply`).
 *
 * Both were seen on a DeepSeek build: every worker died 4–7 minutes in on "Local output
 * repeatedly exceeded the response limit" — a 100–200 line module does not fit the studio's own
 * 3072-token reply, and three cuts in a row ended the session and, with it, the run.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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

const BIG = "big-model";
const SMALL = "small-model";
const BIG_BUDGET = 32_768;
const SMALL_BUDGET = 2_048;

describe("a session's reply budget", () => {
  let root: string;
  before(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "session-budget-"));
  });
  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** Run one session on `model` whose engine answers `answer` on every completion. */
  async function session(
    answer: (request: CompleteRequest) => CompleteResponse,
    replyTokens?: number | ((model: string) => number),
    model: string = BIG,
  ): Promise<{ result: DelegateResult; seen: CompleteRequest[] }> {
    const cwd = await mkdtemp(path.join(root, "game-"));
    await mkdir(cwd, { recursive: true });
    const seen: CompleteRequest[] = [];
    const sessions = new LocalSessions({
      root: path.join(root, "sessions"),
      scratchRoot: path.join(root, "scratch"),
      protectedPaths: [path.join(root, "sessions")],
      contextWindow: 100_000,
      ...(replyTokens === undefined ? {} : { replyTokens }),
      complete: async (request) => {
        seen.push(request);
        return answer(request);
      },
    });
    const request: DelegateRequest = { cwd, prompt: "Write the room module" };
    return { result: await sessions.run(request, model), seen };
  }

  const done = (model = BIG): CompleteResponse => ({
    engine: "bonsai",
    model,
    usage: {},
    stopReason: "stop",
    message: { role: "assistant", content: "Done" },
  });

  it("follows the model it runs on, so a whole module fits one reply", async () => {
    const budget = (model: string) => (model === BIG ? BIG_BUDGET : SMALL_BUDGET);
    const big = await session(() => done(), budget);
    const small = await session(() => done(SMALL), budget, SMALL);
    assert.equal(big.seen[0]?.model, BIG);
    assert.equal(
      big.seen[0]?.maxTokens,
      BIG_BUDGET,
      "the session asks for what the model can write, not the studio's fixed 3072",
    );
    assert.equal(small.seen[0]?.maxTokens, SMALL_BUDGET, "the budget is read per model");
  });

  it("keeps the studio's own reply budget when the engine names none", async () => {
    const { seen } = await session(() => done());
    assert.equal(seen[0]?.maxTokens, 3072, "the default reply budget is unchanged");
  });

  it("a reply cut off by the limit does not fail the whole session", async () => {
    let rounds = 0;
    const { result } = await session(() => {
      rounds += 1;
      // Five cuts in a row, then the round that finally writes the file, then a plain reply.
      if (rounds <= 5)
        return {
          engine: "bonsai",
          model: BIG,
          usage: {},
          stopReason: "length",
          message: { role: "assistant", content: "export const office = { " },
        };
      if (rounds === 6)
        return {
          engine: "bonsai",
          model: BIG,
          usage: {},
          stopReason: "tool_calls",
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              { id: "c1", name: "write_file", arguments: { path: "office.js", content: "export const office = 1;\n" } },
            ],
          },
        };
      return done();
    });
    assert.equal(result.ok, true, "a cut-off reply is not the session's failure");
    assert.equal(rounds, 7, "the session went on across the cuts instead of stopping at the third");
  });

  it("an endless run of cuts still ends the session, bounded, and never as a failure", async () => {
    let rounds = 0;
    const { result } = await session(() => {
      rounds += 1;
      return {
        engine: "bonsai",
        model: BIG,
        usage: {},
        stopReason: "length",
        message: { role: "assistant", content: "export const office = { " },
      };
    });
    assert.equal(result.ok, true, "repeated cuts are never reported as a failed session");
    assert.ok(rounds > 3 && rounds <= 12, `the cuts are bounded, not endless (${rounds} completions)`);
  });
});
