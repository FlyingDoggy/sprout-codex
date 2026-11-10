import { App } from '@modelcontextprotocol/ext-apps'
import type { Dashboard, Pet, QuotaWindow } from '../model'
import { BUBBLE_ROWS, BUBBLE_UNITS, sceneSvg } from '../core/scene'
import { setLang } from '../core/i18n'
import { capsuleSvg, tilesSvg, trendSvg, usageHeatmapSvg, githubHeatmapSvg, mergesSvg } from '../core/panels'
import { addDays, agoText, calendar, dayNumber, formatTokens, formatUsd, mergeCalendar, pipsFor, untilText, wrapText } from '../core/logic'
import { companion } from '../core/companion'
import { esc } from '../core/svg-kit'

setLang('zh')
const root = document.getElementById('app')!
let dashboard: Dashboard | null = null
let range: '30' | 'all' = '30'
try { if (localStorage.getItem('sprout-range') === 'all') range = 'all' } catch {}
let busy = false
let errorText = ''
let actionTimer: ReturnType<typeof setTimeout> | undefined
let app: App | undefined
let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
let playedIntro = false
let drawingWidth = 0
const embedded = window.parent !== window
document.documentElement.dataset.theme = theme

function svg(value: string | null | { svg: string }) {
  const text = typeof value === 'string' ? value : value?.svg ?? ''
  return text.replaceAll('@media (prefers-color-scheme: light)', theme === 'light' ? '@media all' : '@media not all')
}

function quotaText(w: QuotaWindow, d: Dashboard) {
  const label = w.windowMinutes === 300 ? '5 小时' : w.windowMinutes === 10080 ? '本周' : w.label
  const clock = (at: number) => new Intl.DateTimeFormat('zh-CN', { timeZone: d.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at)
  const reset = !w.resetsAt ? '' : w.windowMinutes <= 300 ? `${untilText(w.resetsAt, Date.now())}后重置` : `${clock(w.resetsAt)} 重置`
  const basis = w.forecast?.basis === 'recent' ? (w.windowMinutes === 10080 ? '按最近 24 小时的速度' : '按最近 1 小时的速度') : (w.windowMinutes === 10080 ? '按本周的平均速度' : '按这个窗口的平均速度')
  const sentence = w.usedPercent >= 100 ? (w.resetsAt ? `已用完，${clock(w.resetsAt)} 恢复` : '已用完')
    : w.projected === null ? ''
    : w.forecast?.fullAt ? `${basis}，${clock(w.forecast.fullAt)} 左右就用完`
    : w.windowMinutes === 10080 ? `${basis}，重置时还剩约 ${Math.max(0, 100 - Math.round(w.projected))}%`
    : `${basis}，重置时约 ${Math.round(w.projected)}%`
  return { label, reset, sentence }
}

function render() {
  if (!dashboard) return
  const focus = (document.activeElement as HTMLElement)?.id
  const d = dashboard
  const available = Math.min(512, root.clientWidth) - 32
  // Upstream draws in terminal cell coordinates, then fits the SVG to the desktop pane.
  const width = Math.max(312, Math.min(480, Math.round(available * .8 / 4) * 4))
  drawingWidth = root.clientWidth
  const from = range === '30' ? addDays(d.today, -29) : d.usage.firstDay ?? d.today
  const days = d.usage.days.filter(day => day.day >= from && day.day <= d.today)
  const tokens = days.reduce((sum, day) => sum + day.total, 0)
  const input = days.reduce((sum, day) => sum + day.input, 0)
  const cached = days.reduce((sum, day) => sum + day.cached, 0)
  const cost = days.some(day => day.costUsd === null) ? null : days.reduce((sum, day) => sum + (day.costUsd ?? 0), 0)
  const knownCost = days.reduce((sum, day) => sum + day.knownCostUsd, 0)
  const pet = companion(d)
  const allDays = d.usage.days.map(day => ({ day: day.day, tokens: day.total, costUsd: day.costUsd ?? 0 }))
  const chartDays = calendar(allDays, from, d.today)
  const last10 = calendar(allDays, addDays(d.today, -9), d.today)
  const last7 = last10.slice(-7)
  const isIntro = !playedIntro
  playedIntro = true
  const time = (at: number) => new Intl.DateTimeFormat('zh-CN', { timeZone: d.timezone, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at)
  const quota = d.quota.windows.map(w => {
    const { label, reset, sentence } = quotaText(w, d)
    return `<div class="quota-item"><div class="quota-title"><span>${esc(label)}</span><time>${esc(reset)}</time></div><div class="chart" role="img" aria-label="${esc(label)}已用 ${Math.round(w.usedPercent)}%">${svg(capsuleSvg(width, w.usedPercent, w.projected))}</div>${sentence ? `<p class="note${(w.projected ?? 0) > 100 ? ' error' : ''}">${esc(sentence)}</p>` : ''}</div>`
  }).join('')
  const observed = Math.max(0, ...d.quota.windows.map(w => w.observedAt))
  const gh = d.github
  const availableMergeFrom = gh?.mergesFrom ?? addDays(d.today, -29)
  const mergeFrom = availableMergeFrom > from ? availableMergeFrom : from
  const mergeDays = gh ? mergeCalendar(gh.merges, mergeFrom, d.today) : []
  const mergeTotal = mergeDays.reduce((sum, day) => sum + day.prs, 0)
  const first = d.usage.firstDay
  const rangeLabel = range === 'all' && first ? `自 ${first.slice(0, 4) === d.today.slice(0, 4) ? '' : first.slice(0, 4) + ' 年 '}${Number(first.slice(5, 7))} 月 ${Number(first.slice(8))} 日起` : '最近 30 天'
  const costText = cost !== null ? formatUsd(cost) : knownCost ? `≥${formatUsd(knownCost)}` : '—'
  const section = (heading: string, right: string, body: string) => `<section><div class="section-head"><h2>${heading}</h2>${right}</div>${body}</section>`
  const chart = (source: string | null | { svg: string }, label: string) => `<div class="chart" role="img" aria-label="${esc(label)}">${svg(source)}</div>`
  root.innerHTML = `<main>
    <header><span class="dot" aria-hidden="true"></span><h1>小苗</h1><button class="refresh" id="refresh" title="${time(d.updatedAt)} 更新 · 点击刷新" aria-label="刷新" ${busy ? 'disabled' : ''}>Codex</button></header>
    ${d.demo ? '<p class="note demo">演示</p>' : ''}
    <div class="companion">
      <div class="pet-scene" role="img" aria-label="小苗，Lv${d.pet.highest}：${esc(pet.text)}" title="${esc(pet.text)}&#10;累计 ${formatTokens(d.usage.totals.total)} Token">${sceneSvg({ width, mood: pet.mood, action: pet.action, isConfetti: pet.isConfetti, level: d.pet.highest, pips: pipsFor(d.pet.highest, d.usage.totals.total), isDay: pet.hour >= 7 && pet.hour < 19, rows: wrapText(pet.text, BUBBLE_UNITS, BUBBLE_ROWS).rows, isPop: pet.isPop })}</div>
      <div class="pet-actions"><button id="feed" ${busy ? 'disabled' : ''}>喂水</button><button id="pat" ${busy ? 'disabled' : ''}>摸摸</button><button id="roast" ${busy ? 'disabled' : ''}>再嘴一句</button></div>
      ${errorText ? `<p class="error" role="status">${esc(errorText)}</p>` : ''}
    </div>
    ${section('额度', observed && Date.now() - observed > 15 * 60_000 ? `<span class="note">更新于 ${agoText(observed, Date.now())}</span>` : '', quota || '<p class="note">暂无额度读数</p>')}
    ${first ? section(rangeLabel, `<div class="range" aria-label="统计范围"><button id="range30" aria-pressed="${range === '30'}">30 天</button><button id="rangeAll" aria-pressed="${range === 'all'}">全部</button></div>`, chart(tilesSvg({ width, tokensLabel: range === '30' ? '30 天 token' : '累计 token', tokens, costUsd: cost, knownCostUsd: knownCost, todayUsd: last7.at(-1)?.costUsd ?? 0, streak: pet.streak, week: last7.map(day => day.tokens > 0), cacheHitRate: input ? cached / input : 0, bars: last10.map(day => day.tokens), previous: null, isIntro }), `${rangeLabel}：${formatTokens(tokens)} token，${costText}；连续使用 ${pet.streak} 天；缓存命中 ${input ? (cached / input * 100).toFixed(1) : '0.0'}%`)) : '<p class="note">暂无使用记录</p>'}
    ${first && chartDays.length >= 2 ? section('每日 token', '', chart(trendSvg(width, chartDays, isIntro), '每日 token')) : ''}
    ${mergeTotal ? section('每日合并', `<span class="note">${mergeDays.length} 天 ${mergeTotal} 个 PR${gh?.mergesComplete ? '' : '（部分）'}</span>`, chart(mergesSvg(width, mergeDays, isIntro), '每日合并 PR 和增删行数')) : ''}
    ${first ? section('Codex 使用', `<span class="note">${dayNumber(d.today) - dayNumber(first) + 1} 天里用了 ${d.usage.days.filter(day => day.total > 0 && day.day <= d.today).length} 天</span>`, chart(usageHeatmapSvg(width, allDays, first, d.today, isIntro), 'Codex 使用热力图')) : ''}
    ${gh?.days.length ? section('GitHub 贡献', `<span class="note">过去一年 ${gh.total.toLocaleString()} 次</span>`, chart(githubHeatmapSvg(width, gh.days[0].day, gh.days.map(day => day.level).join(''), d.today, isIntro), 'GitHub 贡献热力图')) : ''}
  </main>`
  if (focus) document.getElementById(focus)?.focus({ preventScroll: true })
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
  if (app) {
    const result = await app.callServerTool({ name, arguments: args })
    if (result.isError) throw new Error(result.content?.find(c => c.type === 'text')?.text ?? '暂时无法读取小苗')
    return result.structuredContent
  }
  const path = name === 'sprout_interact' ? '/api/interact' : '/api/status'
  const response = await fetch(path + (args.refresh ? '?refresh=1' : ''), path === '/api/interact' ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sprout-Request': '1' }, body: JSON.stringify(args) } : {})
  if (!response.ok) throw new Error('暂时无法读取小苗')
  return response.json()
}
async function refresh(force = false) {
  if (busy) return
  busy = true
  try { dashboard = await call('sprout_status', { refresh: force }); errorText = '' }
  catch (error: any) {
    errorText = error.message
    if (!dashboard) root.innerHTML = `<main><div class="loading"><p class="error">${esc(errorText)}</p><button id="refresh">重试</button></div></main>`
  } finally { busy = false; render() }
}
root.addEventListener('click', async event => {
  const id = (event.target as HTMLElement).closest('button')?.id
  if (id === 'range30' || id === 'rangeAll') {
    range = id === 'range30' ? '30' : 'all'
    try { localStorage.setItem('sprout-range', range) } catch {}
    render()
  }
  if (id === 'refresh') await refresh(true)
  if ((id === 'feed' || id === 'pat' || id === 'roast') && dashboard && !busy) {
    busy = true
    root.querySelectorAll<HTMLButtonElement>('.pet-actions button').forEach(button => { button.disabled = true })
    try {
      dashboard.pet = await call('sprout_interact', { action: id }) as Pet
      errorText = ''
      clearTimeout(actionTimer); actionTimer = setTimeout(render, id === 'feed' ? 1900 : 1300)
    } catch (error: any) { errorText = error.message }
    finally { busy = false; render() }
  }
})
let resize: ReturnType<typeof setTimeout>
new ResizeObserver(() => { if (root.clientWidth !== drawingWidth) { clearTimeout(resize); resize = setTimeout(render, 120) } }).observe(root)
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => { theme = event.matches ? 'dark' : 'light'; document.documentElement.dataset.theme = theme; render() })

async function start() {
  if (embedded) {
    app = new App({ name: 'Sprout Codex', version: '0.3.0' }, {})
    app.ontoolresult = result => { const data = result.structuredContent as Dashboard | undefined; if (data?.version === 1) { dashboard = data; render() } }
    app.onhostcontextchanged = context => { if (context.theme) { theme = context.theme; document.documentElement.dataset.theme = theme; render() } }
    await app.connect()
    const context = app.getHostContext()
    if (context?.theme) { theme = context.theme; document.documentElement.dataset.theme = theme }
  }
  await refresh()
  setInterval(() => { if (!document.hidden) void refresh() }, 60_000)
}
void start().catch(() => { root.innerHTML = '<main><p class="error">小苗连接失败，请重新打开面板</p></main>' })
