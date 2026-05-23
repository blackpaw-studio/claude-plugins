import { homedir } from "os";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";

export const STATE_DIR = join(homedir(), ".claude", "channels", "blackpaw-slack");
const ACCESS_FILE = join(STATE_DIR, "access.json");

export interface Access {
  channels: string[];
  mode: "allowlist";
}

export function loadAccess(): Access {
  // env override wins: SLACK_ALLOWED_CHANNELS=C1,C2
  const env = process.env.SLACK_ALLOWED_CHANNELS;
  if (env !== undefined) {
    const channels = env
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (channels.length === 0) {
      console.error(
        "[blackpaw-slack] Warning: SLACK_ALLOWED_CHANNELS is set but empty — all messages will be denied.\n" +
          "  Set it to a comma-separated list of channel IDs, e.g. SLACK_ALLOWED_CHANNELS=C0AHFESPVH6"
      );
    }
    return { channels, mode: "allowlist" };
  }

  if (existsSync(ACCESS_FILE)) {
    try {
      const raw = JSON.parse(readFileSync(ACCESS_FILE, "utf8")) as unknown;
      if (
        raw !== null &&
        typeof raw === "object" &&
        "channels" in raw &&
        Array.isArray((raw as { channels: unknown }).channels)
      ) {
        const channels = (raw as { channels: unknown[] }).channels.filter(
          (c): c is string => typeof c === "string"
        );
        return { channels, mode: "allowlist" };
      }
    } catch {
      /* fall through */
    }
  }

  // Neither env var nor file — warn the operator once.
  console.error(
    "[blackpaw-slack] Warning: no channel allowlist configured — all messages will be denied.\n" +
      "  Run the configure skill or set SLACK_ALLOWED_CHANNELS=<channel-id>[,<channel-id>...]"
  );
  return { channels: [], mode: "allowlist" };
}

export function saveAccess(a: Access): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(ACCESS_FILE, JSON.stringify(a, null, 2));
}

export function isAllowedChannel(
  channel: string,
  access: Access = loadAccess()
): boolean {
  return access.channels.includes(channel);
}

/**
 * Loop guard: returns true if a Slack message event was authored by our own
 * bot or any other bot/system message, indicating it should be dropped.
 *
 * Slack event shapes that should be suppressed:
 *  - Any event with `bot_id` → posted by a bot (including us)
 *  - Any event with a `subtype` → system/edited/joined/etc.
 *  - Any event whose `user` matches our own bot user ID
 */
export function isSelf(
  ev: { user?: string; bot_id?: string; subtype?: string },
  selfBotUserId?: string
): boolean {
  if (ev.bot_id !== undefined) return true; // any bot-authored message
  if (ev.subtype !== undefined) return true; // system/edited/etc subtypes
  if (selfBotUserId !== undefined && ev.user === selfBotUserId) return true;
  return false;
}
