import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { quotaWindowIsLive, type Quota, type QuotaWindow, type Usage } from '../model'

export function readRateLimits(binary = 'codex', codexHome?: string, timeoutMs = 12_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['app-server', '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(codexHome ? { CODEX_HOME: codexHome } : {}) },
    })
    let finished = false
    const finish = (error?: Error, result?: unknown) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      reader.close()
      child.stdin.end()
      child.kill('SIGTERM')
      const kill = setTimeout(() => child.kill('SIGKILL'), 1000)
      kill.unref()
      child.once('exit', () => clearTimeout(kill))
      if (error) reject(error)
      else resolve(result)
    }
    const timer = setTimeout(() => finish(new Error('Codex 额度读取超时。')), timeoutMs)
    const reader = createInterface({ input: child.stdout })
    const send = (value: unknown) => child.stdin.write(`${JSON.stringify(value)}\n`)
    child.stderr.resume()
    child.stdin.on('error', () => finish(new Error('无法连接 Codex 额度接口。')))
    child.on('error', () => finish(new Error('找不到 Codex CLI，请安装后重试。')))
    child.on('exit', () => { if (!finished) finish(new Error('Codex 额度连接已关闭。')) })
    reader.on('line', line => {
      let message: any
      try { message = JSON.parse(line) } catch { return }
      if (message.error && (message.id === 1 || message.id === 2)) {
        finish(new Error('当前 Codex 账号或版本无法提供订阅额度。'))
      } else if (message.id === 1) {
        send({ method: 'initialized' })
        send({ id: 2, method: 'account/rateLimits/read' })
      } else if (message.id === 2) finish(undefined, message.result)
    })
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'sprout_codex', title: 'Sprout Codex', version: '0.1.0' }, capabilities: null } })
  })
}

export function normalizeQuota(raw: any, at: number, now = Date.now()): QuotaWindow[] {
  if (!raw || typeof raw !== 'object') return []
  const buckets: any[] = raw.rateLimitsByLimitId ? Object.values(raw.rateLimitsByLimitId) : [raw.rateLimits ?? raw]
  const windows: QuotaWindow[] = []
  for (const bucket of buckets) {
    if (!bucket || typeof bucket !== 'object') continue
    const id = String(bucket.limitId ?? bucket.limit_id ?? 'codex')
    for (const name of ['primary', 'secondary']) {
      const window = bucket[name]
      const pct = window?.usedPercent ?? window?.used_percent
      const mins = window?.windowDurationMins ?? window?.window_minutes
      const reset = window?.resetsAt ?? window?.resets_at
      if (!Number.isFinite(pct) || pct < 0 || !Number.isFinite(mins) || mins <= 0) continue
      const relative = window?.resetsInSeconds ?? window?.resets_in_seconds
      const absolute = typeof reset === 'number' && Number.isFinite(reset) && reset > 0 ? reset * 1000
        : typeof reset === 'string' && /^\d{4}-\d\d-\d\dT/.test(reset) ? Date.parse(reset) : NaN
      const resetsAt = Number.isFinite(absolute) ? absolute
        : typeof relative === 'number' && Number.isFinite(relative) && relative >= 0 ? at + relative * 1000 : null
      const duration = mins % 10080 === 0 ? `${mins / 10080} 周` : mins % 1440 === 0 ? `${mins / 1440} 天` : mins % 60 === 0 ? `${mins / 60} 小时` : `${mins} 分钟`
      const normalized = { id: `${id}:${name}:${mins}`, label: `${bucket.limitName ?? bucket.limit_name ?? id} · ${duration}`, usedPercent: pct, windowMinutes: mins, resetsAt, observedAt: at, projected: null }
      if (quotaWindowIsLive(normalized, now)) windows.push(normalized)
    }
  }
  return windows
}

export async function getQuota(options: { binary?: string; codexHome: string; live: boolean }, fallback: Usage['lastQuota']): Promise<Quota> {
  let message: string | null = null
  if (options.live) {
    try {
      const raw = await readRateLimits(options.binary, options.codexHome)
      const windows = normalizeQuota(raw, Date.now())
      if (windows.length) return { source: 'live', windows, message: null }
      message = '当前账号未返回订阅额度。'
    } catch (error: any) { message = error.message }
  }
  const windows = fallback ? normalizeQuota(fallback.value, fallback.at) : []
  return {
    source: windows.length ? 'session' : 'unavailable', windows,
    message: windows.length ? '额度来自最近的本机会话记录，可能与当前剩余额度不同。' : message ?? '暂无额度记录；使用 Codex 后刷新即可。',
  }
}
