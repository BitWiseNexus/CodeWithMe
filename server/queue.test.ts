import { describe, expect, it } from "vitest";
import { RUN_STREAM, SUBMIT_STREAM } from "@/lib/exec";
import { byPriority, parseReadReply } from "./queue";

describe("parseReadReply", () => {
  it("flattens a multi-stream XREADGROUP reply", () => {
    const reply: Parameters<typeof parseReadReply>[0] = [
      [RUN_STREAM, [["5-0", ["job", '{"a":1}']]]],
      [SUBMIT_STREAM, [["3-0", ["job", '{"b":2}']], ["4-0", ["other", "x"]]]],
    ];
    expect(parseReadReply(reply)).toEqual([
      { stream: RUN_STREAM, id: "5-0", raw: '{"a":1}', deliveries: 1 },
      { stream: SUBMIT_STREAM, id: "3-0", raw: '{"b":2}', deliveries: 1 },
      { stream: SUBMIT_STREAM, id: "4-0", raw: "", deliveries: 1 },
    ]);
  });

  it("handles a timed-out read", () => {
    expect(parseReadReply(null)).toEqual([]);
  });
});

describe("byPriority", () => {
  it("puts runs before submissions, then oldest first", () => {
    const d = (stream: string, id: string) => ({ stream, id, raw: "", deliveries: 1 });
    const sorted = [d(SUBMIT_STREAM, "1-0"), d(RUN_STREAM, "10-0"), d(RUN_STREAM, "9-0")].sort(byPriority);
    expect(sorted.map((x) => `${x.stream === RUN_STREAM ? "run" : "submit"}:${x.id}`)).toEqual([
      "run:9-0",
      "run:10-0",
      "submit:1-0",
    ]);
  });
});
