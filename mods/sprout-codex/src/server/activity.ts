import type { Activity, WorkEvent } from '../model'
import type { TaskContext } from '../core/personality'
import { classifyTask, userRequest } from './task-context'

/** Only lifecycle metadata and task labels survive parsing, never prompts or tool output. */
export type ActivityState = {
  session: string; parent: string; cwd: string; agent: boolean; turn: string; startedAt: number; updatedAt: number;
  active: boolean; planning: boolean; failures: number; approvals: number;
  event: Activity['event']; lastItem: string;
  task?: TaskContext;
}
export const freshActivity = (): ActivityState => ({ session: '', parent: '', cwd: '', agent: false, turn: '', startedAt: 0, updatedAt: 0, active: false, planning: false, failures: 0, approvals: 0, event: null, lastItem: '' })

function isTestCommand(command: unknown) {
  const text = (Array.isArray(command) ? String(command.at(-1) ?? '') : typeof command === 'string' ? command : '').trim()
  // Do not treat examples inside scripts/heredocs as commands that actually ran.
  if (text.includes('<<') || /[;\n|]/.test(text)) return false
  // An unrelated command, pipe or fallback can mask a test's exit code.
  return text.split('&&').every(part => /^\s*(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test(?::[\w-]+)?|check|lint|typecheck|build)\b|(?:npx\s+)?(?:vitest|jest|tsc|pytest)\b|python[\d.]*\s+-m\s+(?:pytest|unittest)\b|(?:cargo|go)\s+test\b|node\s+(?:--\S+\s+)*--test\b)/.test(part))
}

export function consumeActivity(state: ActivityState, record: any) {
  const p = record.payload
  if (!p || typeof p !== 'object') return
  const at = Date.parse(record.timestamp)
  if (record.type === 'session_meta') {
    state.session = String(p.id ?? p.session_id ?? '')
    state.agent = !!(p.source && typeof p.source === 'object' && p.source.subagent)
    state.parent = typeof p.source?.subagent?.thread_spawn?.parent_thread_id === 'string' ? p.source.subagent.thread_spawn.parent_thread_id : ''
    if (typeof p.cwd === 'string') state.cwd = p.cwd
    return
  }
  if (!Number.isFinite(at)) return
  const request = userRequest(record)
  if (request && at >= (state.task?.at ?? 0)) {
    state.task = classifyTask(request, at, state.task)
    return
  }
  if (at < state.updatedAt) return
  if (record.type === 'turn_context') { if (typeof p.cwd === 'string') state.cwd = p.cwd; return }
  const event = (kind: WorkEvent) => { state.event = { kind, at, failures: state.failures } }
  if (record.type === 'compacted') { event('compact'); state.updatedAt = at; return }
  if (record.type !== 'event_msg') return
  if (p.type === 'task_started') {
    if (state.turn !== p.turn_id) { state.failures = 0; state.approvals = 0; state.event = null }
    state.turn = String(p.turn_id ?? '')
    state.startedAt = at; state.active = true; state.planning = String(p.collaboration_mode_kind).toLowerCase() === 'plan'
  } else if (p.type === 'task_complete' || p.type === 'turn_aborted') {
    if (p.turn_id && state.turn && p.turn_id !== state.turn) return
    state.active = false
    if (p.type === 'turn_aborted') event('interrupted')
    else if (!state.event || at - state.event.at > 60_000) event('done')
  } else if (p.type === 'item_completed') {
    const item = p.item ?? {}
    if (item.id && item.id === state.lastItem) return
    state.lastItem = String(item.id ?? '')
    if (item.type === 'ContextCompaction' || item.type === 'contextCompaction') event('compact')
    if ((item.type === 'CommandExecution' || item.type === 'commandExecution') && isTestCommand(item.command)) {
      const exit = item.exit_code ?? item.exitCode
      if (typeof exit === 'number' && exit !== 0) { state.failures++; event('test_failed') }
      if (exit === 0 && state.failures > 0) { event('test_passed'); state.failures = 0 }
    }
    if (item.type === 'McpToolCall' && /request_user_input/.test(String(item.tool))) {
      if (++state.approvals >= 2) event('approval')
    }
  } else if (p.type !== 'token_count') return
  state.updatedAt = at
}

export function threadActivity(states: ActivityState[], threadId: string) {
  const family = new Set([threadId])
  for (let size = 0; size !== family.size;) {
    size = family.size
    for (const s of states) if (s.parent && family.has(s.parent)) family.add(s.session)
  }
  return states.filter(s => family.has(s.session))
}

export function activityOf(states: ActivityState[], now = Date.now()): Activity {
  // Copied fork history does not create another worker or replay old celebrations.
  const unique = new Map<string, ActivityState>()
  for (const s of states) {
    const key = s.turn || s.session
    if (!key) continue
    const old = unique.get(key)
    if (!old || old.updatedAt < s.updatedAt) unique.set(key, s)
  }
  const current = [...unique.values()].filter(s => s.updatedAt <= now && now - s.updatedAt < 5 * 60_000)
  const active = current.filter(s => s.active)
  const latest = current.map(s => s.event).filter((e): e is NonNullable<Activity['event']> => !!e && now - e.at < 90_000 && e.at <= now).sort((a,b) => b.at - a.at)[0] ?? null
  return { active: active.length, agents: active.filter(s => s.agent).length,
    startedAt: active.length ? Math.min(...active.map(s => s.startedAt)) : null,
    planning: active.some(s => s.planning), event: latest }
}
