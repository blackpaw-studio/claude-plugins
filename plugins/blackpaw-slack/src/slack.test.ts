import { test, expect } from "bun:test";
import { normalizeThread } from "./slack";

test("top-level message starts its own thread", () => {
  const r = normalizeThread({ channel: "C1", ts: "100.1" });
  expect(r.thread_ts).toBe("100.1");
  expect(r.ts).toBe("100.1");
  expect(r.channel).toBe("C1");
});

test("threaded reply keeps the parent thread_ts", () => {
  const r = normalizeThread({ channel: "C1", ts: "200.2", thread_ts: "100.1" });
  expect(r.thread_ts).toBe("100.1");
  expect(r.ts).toBe("200.2");
});
