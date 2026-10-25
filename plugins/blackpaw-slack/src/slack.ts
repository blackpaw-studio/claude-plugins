import type { WebClient } from "@slack/web-api";
import { chunk, SLACK_CHUNK_LIMIT } from "./chunk";

export interface SlackMessageLike {
  channel: string;
  ts: string;
  thread_ts?: string;
}

/** A top-level message starts its own thread; a reply keeps its parent thread_ts. */
export function normalizeThread(ev: SlackMessageLike): { channel: string; ts: string; thread_ts: string } {
  return { channel: ev.channel, ts: ev.ts, thread_ts: ev.thread_ts ?? ev.ts };
}

/** Post text to a channel/thread, chunking to stay under Slack's limit. Returns the first message ts. */
export async function postMessage(
  client: WebClient,
  args: { channel: string; thread_ts?: string; text: string },
): Promise<string> {
  const parts = chunk(args.text, SLACK_CHUNK_LIMIT, "newline");
  let firstTs: string | undefined;
  let thread = args.thread_ts;
  for (const part of parts.length ? parts : [""]) {
    const res = await client.chat.postMessage({ channel: args.channel, thread_ts: thread, text: part || " " });
    if (!firstTs) firstTs = res.ts as string;
    // keep subsequent chunks in the same thread
    if (!thread && res.ts) thread = (args.thread_ts ?? res.ts) as string;
  }
  return firstTs!;
}

export async function updateMessage(
  client: WebClient,
  args: { channel: string; ts: string; text: string },
): Promise<void> {
  await client.chat.update({ channel: args.channel, ts: args.ts, text: args.text });
}

export async function addReaction(
  client: WebClient,
  args: { channel: string; ts: string; name: string },
): Promise<void> {
  try {
    await client.reactions.add({ channel: args.channel, timestamp: args.ts, name: args.name });
  } catch (e: any) {
    if (e?.data?.error !== "already_reacted") throw e;
  }
}
