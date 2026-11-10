import { basename, win32 } from 'node:path'
import type { PanelContext } from '../model'

/** Codex passes turn metadata on tool calls. Never infer the current chat from the latest global log. */
export function panelContext(args: PanelContext, meta?: Record<string, unknown>): PanelContext {
  let turn: any = meta?.['x-codex-turn-metadata']
  if (typeof turn === 'string') { try { turn = JSON.parse(turn) } catch { turn = null } }
  const id = meta?.['openai/threadId'] ?? meta?.['openai/thread_id'] ?? meta?.codexThreadId ?? meta?.threadId ?? meta?.thread_id ?? turn?.thread_id
  const hostId = typeof id === 'string' && id ? id : undefined
  const switched = hostId && args.threadId && hostId !== args.threadId
  return { ...(hostId ? { threadId: hostId } : args.threadId ? { threadId: args.threadId } : {}), ...(args.cwd && !switched ? { cwd: args.cwd } : {}) }
}

export function folderName(cwd?: string): string | null {
  if (!cwd?.trim()) return null
  const path = cwd.replace(/[\\/]+$/, '')
  return (path.includes('\\') ? win32.basename(path) : basename(path)) || null
}
