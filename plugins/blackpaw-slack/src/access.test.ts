import { test, expect, afterEach } from "bun:test";
import { isAllowedChannel, isSelf, loadAccess } from "./access";

afterEach(() => {
  delete process.env.SLACK_ALLOWED_CHANNELS;
});

test("env override allowlist parses and matches", () => {
  process.env.SLACK_ALLOWED_CHANNELS = "C0AHFESPVH6, C999";
  expect(isAllowedChannel("C0AHFESPVH6")).toBe(true);
  expect(isAllowedChannel("C999")).toBe(true);
  expect(isAllowedChannel("CNOPE")).toBe(false);
});

test("empty allowlist denies", () => {
  process.env.SLACK_ALLOWED_CHANNELS = "";
  expect(isAllowedChannel("Cwhatever")).toBe(false);
});

test("loadAccess returns empty channels when env is empty string", () => {
  process.env.SLACK_ALLOWED_CHANNELS = "";
  const access = loadAccess();
  expect(access.channels).toEqual([]);
  expect(access.mode).toBe("allowlist");
});

test("loadAccess trims and filters whitespace-only entries", () => {
  process.env.SLACK_ALLOWED_CHANNELS = "C0AHFESPVH6,  , C999,  ";
  const access = loadAccess();
  expect(access.channels).toEqual(["C0AHFESPVH6", "C999"]);
});

test("isSelf rejects bot-authored, system, and own-user messages", () => {
  expect(isSelf({ bot_id: "B1" })).toBe(true);
  expect(isSelf({ subtype: "message_changed" })).toBe(true);
  expect(isSelf({ user: "U0B5QBU75QS" }, "U0B5QBU75QS")).toBe(true);
  expect(isSelf({ user: "UHUMAN" }, "U0B5QBU75QS")).toBe(false);
});

test("isSelf allows human message when no selfBotUserId is given", () => {
  expect(isSelf({ user: "UHUMAN" })).toBe(false);
});

test("isSelf allows human message when user does not match selfBotUserId", () => {
  expect(isSelf({ user: "UHUMAN" }, "UBOT")).toBe(false);
});

test("isSelf blocks message with both bot_id and user", () => {
  // bot_id alone is sufficient to block
  expect(isSelf({ bot_id: "BBOT", user: "UHUMAN" })).toBe(true);
});
