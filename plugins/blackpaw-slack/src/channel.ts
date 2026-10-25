import type { Server } from '@modelcontextprotocol/sdk/server/index.js'

export interface SlackChannelMeta {
  source: 'blackpaw-slack'
  channel: string
  thread_ts: string
  ts: string
  user?: string
  user_name?: string
}

export async function emitChannel(mcp: Server, content: string, meta: SlackChannelMeta): Promise<void> {
  await mcp.notification({
    method: 'notifications/claude/channel',
    params: { content, meta },
  })
}
