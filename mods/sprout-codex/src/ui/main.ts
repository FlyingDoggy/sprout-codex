import manifest from '../../package.json'
import { App } from '@modelcontextprotocol/ext-apps'
import { PET_ACTIONS, type Dashboard, type Pet, type QuotaWindow, type PanelContext } from '../model'
import { openGrowth, refreshGrowth } from './growth'
import { BUBBLE_ROWS, BUBBLE_UNITS, sceneSvg } from '../core/scene'
import { setLang } from '../core/i18n'
import { capsuleSvg, tilesSvg, trendSvg, usageHeatmapSvg, githubHeatmapSvg, mergesSvg } from '../core/panels'
import { addDays, agoText, calendar, dayNumber, formatTokens, formatUsd, introStep, mergeCalendar, pipsFor, untilText, wrapText } from '../core/logic'
import type { SproutIntroKind, SproutIntroPlayed } from '../types'
import { companion } from '../core/companion'
import { esc } from '../core/svg-kit'

setLang('zh')
const root = document.getElementById('app')!
let dashboard: Dashboard | null = null
let panelContext: PanelContext = {}
let range: '30' | 'all' = '30'
try { if (localStorage.getItem('sprout-range') === 'all') range = 'all' } catch {}
let busy = false
let errorText = ''
let actionTimer: ReturnType<typeof setTimeout> | undefined
let app: App | undefined
let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
const introSeen = new Map<SproutIntroKind, string | null>()
let introPlayed: SproutIntroPlayed = {}
try { introPlayed = JSON.parse(localStorage.getItem('sprout-intros') ?? '{}') ?? {} } catch {}
let drawingWidth = 0
let lastSceneMarkup = ''
const embedded = window.parent !== window
document.documentElement.dataset.theme = theme


function svg(value: string | null | { svg: string }) {
  const text = typeof value === 'string' ? value : value?.svg ?? ''
  return text.replaceAll('@media (prefers-color-scheme: light)', theme === 'light' ? '@media all' : '@media not all')
}

function updatePanel(markup: string) {
  const template = document.createElement('template')
  template.innerHTML = markup
  const next = template.content.querySelector('main')!
  const current = root.querySelector('main')
  if (!current?.querySelector('.range')) { root.replaceChildren(template.content); return }
  const key = (element: Element) => element.querySelector('.range') ? 'stats' : element.tagName === 'SECTION' ? element.querySelector('h2')?.textContent : `${element.tagName}.${element.className}`
  const old = new Map([...current.children].map(element => [key(element), element]))
  let cursor = current.firstElementChild
  for (const element of [...next.children]) {
    const previous = old.get(key(element))
    let kept = element
    if (previous) {
      if (previous !== cursor) current.insertBefore(previous, cursor)
      if (key(element) === 'stats') {
        // Keep the actual controls mounted: clicking or refreshing must not drop :hover/focus.
        previous.querySelector('h2')!.textContent = element.querySelector('h2')!.textContent
        const oldChart = previous.querySelector('.chart')!, newChart = element.querySelector('.chart')!
        // Unchanged SVG nodes keep their running pulse and entrance animations.
        if (oldChart.outerHTML !== newChart.outerHTML) oldChart.replaceWith(newChart)
        for (const button of previous.querySelectorAll('.range button')) {
          button.setAttribute('aria-pressed', element.querySelector(`#${button.id}`)!.getAttribute('aria-pressed')!)
        }
        kept = previous
      } else if (previous.outerHTML === element.outerHTML) kept = previous
      else previous.replaceWith(element)
    } else current.insertBefore(element, cursor)
    cursor = kept.nextElementSibling
  }
  while (cursor) { const next = cursor.nextElementSibling; cursor.remove(); cursor = next }
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

function sceneMarkup(d: Dashboard, width: number) {
  const pet = companion(d)
  return { pet, markup: sceneSvg({ width, mood: pet.mood, action: pet.action, isConfetti: pet.isConfetti,
    level: d.pet.highest, pips: pipsFor(d.pet.highest, d.usage.totals.total), isDay: pet.hour >= 7 && pet.hour < 19,
    rows: wrapText(pet.text, BUBBLE_UNITS, BUBBLE_ROWS).rows, isPop: pet.isPop,
    effect: pet.effect, cat: pet.showCat, canPray: pet.canPray, agents: pet.agents }) }
}
function refreshScene() {
  if (!dashboard || document.hidden) return
  const element = root.querySelector<HTMLElement>('.pet-scene')
  if (!element) return
  const { pet, markup } = sceneMarkup(dashboard, Number(element.dataset.width))
  if (markup === lastSceneMarkup) return
  const focus = document.activeElement?.getAttribute('data-action')
  element.innerHTML = markup
  element.setAttribute('aria-label', `小苗，Lv${dashboard.pet.highest}：${pet.text}`)
  element.title = `${pet.text}\n累计 ${formatTokens(dashboard.usage.totals.total)} Token`
  lastSceneMarkup = markup
  if (focus) element.querySelector<SVGElement>(`[data-action="${focus}"]`)?.focus({ preventScroll: true })
}

function render() {
  if (!dashboard) return
  const focus = (document.activeElement as HTMLElement)?.id
  const sceneFocus = document.activeElement?.getAttribute('data-action')
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
  const { pet, markup: scene } = sceneMarkup(d, width)
  lastSceneMarkup = scene
  const allDays = d.usage.days.map(day => ({ day: day.day, tokens: day.total, costUsd: day.costUsd ?? 0 }))
  const chartDays = calendar(allDays, from, d.today)
  const last10 = calendar(allDays, addDays(d.today, -9), d.today)
  const last7 = last10.slice(-7)
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
  const tilesInput = { width, tokensLabel: range === '30' ? '30 天 token' : '累计 token', tokens, costUsd: cost, knownCostUsd: knownCost, todayUsd: last7.at(-1)?.costUsd ?? 0, streak: pet.streak, week: last7.map(day => day.tokens > 0), cacheHitRate: input ? cached / input : 0, bars: last10.map(day => day.tokens), previous: null }
  // Keep the upstream per-chart entrance lifecycle; a pet click is not new chart data.
  const { intro, started } = introStep(introSeen, {
    tiles:first ? JSON.stringify(tilesInput) : null,
    trend:first && chartDays.length >= 2 ? JSON.stringify([width, chartDays]) : null,
    merges:mergeTotal ? JSON.stringify([width, mergeDays]) : null,
    clay:first ? JSON.stringify([width, d.today, first, allDays]) : null,
    github:gh?.days.length ? JSON.stringify([width, d.today, gh.days]) : null,
  }, introPlayed, d.today)
  if (started.length) {
    introPlayed = { ...introPlayed, ...Object.fromEntries(started.map(kind => [kind, d.today])) }
    try { localStorage.setItem('sprout-intros', JSON.stringify(introPlayed)) } catch {}
  }
  const rangeLabel = range === 'all' && first ? `自 ${first.slice(0, 4) === d.today.slice(0, 4) ? '' : first.slice(0, 4) + ' 年 '}${Number(first.slice(5, 7))} 月 ${Number(first.slice(8))} 日起` : '最近 30 天'
  const costText = cost !== null ? formatUsd(cost) : knownCost ? `≥${formatUsd(knownCost)}` : '—'
  const section = (heading: string, right: string, body: string) => `<section><div class="section-head"><h2>${heading}</h2>${right}</div>${body}</section>`
  const chart = (source: string | null | { svg: string }, label: string) => `<div class="chart" role="img" aria-label="${esc(label)}">${svg(source)}</div>`
  updatePanel(`<main>
    <header><span class="dot" aria-hidden="true"></span><h1>小苗</h1><button class="refresh" id="refresh" title="${esc(d.projectName??'')} · ${time(d.updatedAt)} 更新 · 点击刷新" aria-label="刷新" ${busy ? 'disabled' : ''}>${esc(d.projectName??'')}</button></header>
    ${d.demo ? '<p class="note demo">演示</p>' : ''}
    <div class="companion">
      <div class="pet-scene" role="group" data-width="${width}" aria-label="小苗，Lv${d.pet.highest}：${esc(pet.text)}" title="${esc(pet.text)}&#10;累计 ${formatTokens(d.usage.totals.total)} Token">${scene}</div>
      <div class="pet-actions"><button id="feed" ${busy ? 'disabled' : ''}>喂水</button><button id="pat" ${busy ? 'disabled' : ''}>摸摸</button><button id="roast" ${busy ? 'disabled' : ''}>再嘴一句</button></div>
      ${errorText ? `<p class="error" role="status">${esc(errorText)}</p>` : ''}
    </div>
    ${section('额度', observed && Date.now() - observed > 15 * 60_000 ? `<span class="note">更新于 ${agoText(observed, Date.now())}</span>` : '', quota || '<p class="note">暂无额度读数</p>')}
    ${first ? section(rangeLabel, `<div class="range" aria-label="统计范围"><button id="range30" aria-pressed="${range === '30'}">30 天</button><button id="rangeAll" aria-pressed="${range === 'all'}">全部</button></div>`, chart(tilesSvg({ ...tilesInput, isIntro:intro.has('tiles') }), `${rangeLabel}：${formatTokens(tokens)} token，${costText}；连续使用 ${pet.streak} 天；缓存命中 ${input ? (cached / input * 100).toFixed(1) : '0.0'}%`)) : `<p class="note">${d.usage.loading ? '正在读取历史用量…' : '暂无使用记录'}</p>`}
    ${first && chartDays.length >= 2 ? section('每日 token', '', chart(trendSvg(width, chartDays, intro.has('trend')), '每日 token')) : ''}
    ${mergeTotal ? section('每日合并', `<span class="note">${mergeDays.length} 天 ${mergeTotal} 个 PR${gh?.mergesComplete ? '' : '（部分）'}</span>`, chart(mergesSvg(width, mergeDays, intro.has('merges')), '每日合并 PR 和增删行数')) : ''}
    ${first ? section('Codex 使用', `<span class="note">${dayNumber(d.today) - dayNumber(first) + 1} 天里用了 ${d.usage.days.filter(day => day.total > 0 && day.day <= d.today).length} 天</span>`, chart(usageHeatmapSvg(width, allDays, first, d.today, intro.has('clay')), 'Codex 使用热力图')) : ''}
    ${gh?.days.length ? section('GitHub 贡献', `<span class="note">过去一年 ${gh.total.toLocaleString()} 次</span>`, chart(githubHeatmapSvg(width, gh.days[0].day, gh.days.map(day => day.level).join(''), d.today, intro.has('github')), 'GitHub 贡献热力图')) : ''}
  </main>`)
  if (focus) document.getElementById(focus)?.focus({ preventScroll: true })
  else if (sceneFocus) root.querySelector<SVGElement>(`[data-action="${sceneFocus}"]`)?.focus({ preventScroll: true })
  refreshGrowth(d)
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
  if (app) {
    const result = await app.callServerTool({ name, arguments: { ...panelContext, ...args } })
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
  try { dashboard = await call('sprout_status', { refresh: force }); panelContext = dashboard?.context ?? panelContext; errorText = '' }
  catch (error: any) {
    errorText = error.message
    if (!dashboard) root.innerHTML = `<main><div class="loading"><p class="error">${esc(errorText)}</p><button id="refresh">重试</button></div></main>`
  } finally { busy = false; render() }
}
root.addEventListener('click', async event => {
  const target = (event.target as Element).closest<HTMLElement>('button,[data-action]')
  const id = target?.dataset.action ?? target?.id
  if (id === 'gallery' && dashboard) openGrowth(dashboard)
  if (id === 'range30' || id === 'rangeAll') {
    range = id === 'range30' ? '30' : 'all'
    try { localStorage.setItem('sprout-range', range) } catch {}
    render()
  }
  if (id === 'refresh') await refresh(true)
  if (id && PET_ACTIONS.some(action => action === id) && dashboard && !busy) {
    busy = true
    root.querySelectorAll<HTMLButtonElement>('.pet-actions button').forEach(button => { button.disabled = true })
    try {
      dashboard.pet = await call('sprout_interact', { action: id }) as Pet
      errorText = ''
      clearTimeout(actionTimer); actionTimer = setTimeout(refreshScene, id === 'pray' ? 4100 : 2900)
    } catch (error: any) { errorText = error.message }
    finally { busy = false; render() }
  }
})
root.addEventListener('keydown', event => {
  const target = (event.target as Element).closest('[data-action]')
  if (target && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault(); target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }
})
let resize: ReturnType<typeof setTimeout>
new ResizeObserver(() => { if (root.clientWidth !== drawingWidth) { clearTimeout(resize); resize = setTimeout(render, 120) } }).observe(root)
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => { theme = event.matches ? 'dark' : 'light'; document.documentElement.dataset.theme = theme; render() })

async function start() {
  if (embedded) {
    app = new App({ name: 'Sprout Codex', version: manifest.version }, {})
    app.ontoolresult = result => { const data = result.structuredContent as Dashboard | undefined; if (data?.version === 1) { dashboard = data; panelContext=data.context??panelContext; render() } }
    app.onhostcontextchanged = context => { if (context.theme) { theme = context.theme; document.documentElement.dataset.theme = theme; render() } }
    await app.connect()
    const context = app.getHostContext()
    if (context?.theme) { theme = context.theme; document.documentElement.dataset.theme = theme }
  }
  await refresh()
  setInterval(() => { if (!document.hidden) void refresh() }, 15_000)
  setInterval(refreshScene, 1000)
}
void start().catch(() => { root.innerHTML = '<main><p class="error">小苗连接失败，请重新打开面板</p></main>' })
