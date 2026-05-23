import { test, expect } from "bun:test";
import { chunk, SLACK_CHUNK_LIMIT } from "./chunk";

test("splits a long string into <=limit pieces", () => {
  const s = "x".repeat(7000);
  const parts = chunk(s, SLACK_CHUNK_LIMIT, "length");
  expect(parts.length).toBe(3);
  for (const p of parts) expect(p.length).toBeLessThanOrEqual(SLACK_CHUNK_LIMIT);
  expect(parts.join("")).toBe(s);
});

test("newline mode splits on newline boundaries", () => {
  const s = Array.from({length: 200}, (_,i)=>`line ${i}`).join("\n");
  const parts = chunk(s, 100, "newline");
  expect(parts.length).toBeGreaterThan(1);
  for (const p of parts) expect(p.length).toBeLessThanOrEqual(100 + 20);
});
