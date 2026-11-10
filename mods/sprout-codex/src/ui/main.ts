import { App } from '@modelcontextprotocol/ext-apps'
import type { Dashboard, Pet } from '../model'
import { sceneSvg } from '../core/scene'
import { setLang } from '../core/i18n'
import { capsuleSvg, trendSvg, usageHeatmapSvg, githubHeatmapSvg, mergesSvg } from '../core/panels'
import { addDays, calendar, formatTokens, formatUsd, mergeCalendar, pipsFor, streakOf } from '../core/logic'
import { esc } from '../core/svg-kit'
import { levelInfo, MAX_LEVEL } from '../core/levels'

setLang('zh')
const root = document.getElementById('app')!
let dashboard: Dashboard | null = null
let range: '30' | 'all' = 'all'
let busy = false
let toast = ''
let actionTimer: ReturnType<typeof setTimeout> | undefined
let app: App | undefined
let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
const embedded = window.parent !== window
document.documentElement.dataset.theme = theme

function svg(value: string | null | { svg: string }) {
  const text = typeof value === 'string' ? value : value?.svg ?? ''
  return text.replaceAll('@media (prefers-color-scheme: light)', theme === 'light' ? '@media all' : '@media not all')
}
function render() {
  if (!dashboard) return
  const focus = (document.activeElement as HTMLElement)?.id
  const d = dashboard
  const narrow = matchMedia('(max-width: 740px)').matches
  const available = Math.min(1100, root.clientWidth) - (narrow ? 36 : 60)
  const width = Math.max(240, narrow ? available : (available - 40) / 2)
  const from = range === '30' ? addDays(d.today, -29) : d.usage.firstDay ?? d.today
  const days = d.usage.days.filter(day => day.day >= from && day.day <= d.today)
  const tokens = days.reduce((sum, day) => sum + day.total, 0)
  const input = days.reduce((sum, day) => sum + day.input, 0)
  const cached = days.reduce((sum, day) => sum + day.cached, 0)
  const cost = days.some(day => day.costUsd === null) ? null : days.reduce((sum, day) => sum + (day.costUsd ?? 0), 0)
  const knownCost = days.reduce((sum, day) => sum + day.knownCostUsd, 0)
  const pricedTokens = days.reduce((sum, day) => sum + day.pricedTokens, 0)
  const level = levelInfo(d.pet.highest)
  const next = d.pet.highest < MAX_LEVEL ? levelInfo(d.pet.highest + 1) : null
  const growth = next ? Math.max(0, Math.min(1, (d.usage.totals.total / 1e9 - level.thresholdB) / (next.thresholdB - level.thresholdB))) : 1
  const streak = streakOf(d.usage.days.filter(day => day.total > 0).map(day => day.day), d.today)
  const todayTokens = d.usage.days.find(day => day.day === d.today)?.total ?? 0
  const action = Date.now() - d.pet.actionAt < 1600 ? d.pet.action : null
  const worried = d.quota.windows.some(w => w.usedPercent >= 85)
  const mood = worried ? 'worry' : todayTokens ? 'happy' : 'sleep'
  const rows = action === 'feed' ? ['咕嘟咕嘟，今天也要', '长高一点点。'] : action === 'pat' ? ['摸摸收到。', '你忙，我陪着。'] : worried ? ['额度有点紧，', '记得歇一歇。'] : todayTokens ? ['你写代码，', '我负责慢慢长大。'] : ['先歇一会儿。', '开工时记得叫我。']
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: d.timezone, hour: '2-digit', hourCycle: 'h23' }).format(Date.now()))
  const chartDays = calendar(days.map(day => ({ day: day.day, tokens: day.total, costUsd: day.costUsd ?? 0 })), from, d.today)
  const time = (at: number) => new Intl.DateTimeFormat('zh-CN', { timeZone: d.timezone, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(at)
  const quota = d.quota.windows.map(w => `<div class="quota-item"><div class="quota-title"><span>${esc(w.label)}</span><time>${w.resetsAt ? `${time(w.resetsAt)} 重置` : '重置时间未知'}</time></div><div class="chart" role="img" aria-label="${esc(w.label)}已使用 ${Math.round(w.usedPercent)}%">${svg(capsuleSvg(width, w.usedPercent, w.projected))}</div>${w.projected === null ? '' : `<p class="note">按当前节奏估算，重置时使用约 ${Math.round(w.projected)}%。</p>`}<p class="note">读数：${time(w.observedAt)}</p></div>`).join('')
  const gh = d.github
  const mergeTotal = gh?.merges.filter(day => day.day >= addDays(d.today, -29) && day.day <= d.today).reduce((sum, day) => sum + day.prs, 0) ?? 0
  root.innerHTML = `<main>
    <header><div class="identity"><span class="dot" aria-hidden="true"></span><div><h1>小苗</h1><div class="subtitle">SPROUT · CODEX</div></div></div><div class="header-right"><span class="updated">${time(d.updatedAt)} 更新</span><button id="refresh" ${busy ? 'disabled' : ''}>${busy ? '刷新中…' : '刷新'}</button></div></header>
    ${d.demo ? '<p class="notice">演示模式 · 以下为示例数据，不代表你的实际用量。</p>' : ''}
    ${d.usage.warnings.map(w => `<p class="notice">${esc(w)}</p>`).join('')}
    <div class="layout"><div class="column">
      <div class="pet-scene" role="img" aria-label="小苗，等级 ${d.pet.highest}，${action === 'feed' ? '正在喝水' : action === 'pat' ? '被摸摸' : '陪伴中'}">${sceneSvg({ width, mood, action, isConfetti: false, level: d.pet.highest, pips: pipsFor(d.pet.highest, d.usage.totals.total), isDay: hour >= 7 && hour < 19, rows, isPop: action !== null })}</div>
      <div class="pet-actions"><button id="feed" ${busy ? 'disabled' : ''}>喂水</button><button id="pat" ${busy ? 'disabled' : ''}>摸摸</button><span class="pet-count">喂水 ${d.pet.fed} · 摸摸 ${d.pet.patted}</span></div>
      <div class="toast" role="status" aria-live="polite">${esc(toast)}</div>
      <section class="growth" aria-label="历史累计成长值"><div class="growth-head"><span>历史累计成长值</span><strong title="${d.usage.totals.total.toLocaleString()} Token">${formatTokens(d.usage.totals.total)} <small>Token</small></strong></div><progress aria-label="升级进度" value="${growth}" max="1"></progress><div class="growth-caption"><span>Lv${level.lv} ${level.name}</span><span>${next ? `${(growth * 100).toFixed(1)}% · Lv${next.lv} 需 ${formatTokens(next.thresholdB * 1e9)}` : '已长成传说金树'}</span></div><p class="note">${d.usage.firstDay ? `已计入 ${d.usage.firstDay} 起的全部本机历史及归档记录。` : '找到本机历史记录后自动计入。'}成长值不受下方时间筛选影响。</p></section>
      <section class="section"><div class="section-head"><h2>订阅额度</h2><span class="note">${d.quota.source === 'live' ? '实时读取' : d.quota.source === 'session' ? '最近会话' : ''}</span></div>${quota || '<div class="empty">暂无额度读数。使用已登录订阅账号的 Codex 后刷新。</div>'}${d.quota.message ? `<p class="note">${esc(d.quota.message)}</p>` : ''}</section>
      <section class="section"><div class="section-head"><h2>${range === '30' ? '最近 30 天' : '全部记录'}</h2><div class="range" aria-label="统计范围"><button id="range30" aria-pressed="${range === '30'}">30 天</button><button id="rangeAll" aria-pressed="${range === 'all'}">全部</button></div></div>
        <dl class="tiles"><div class="tile"><dt>Token 用量</dt><dd>${formatTokens(tokens)}</dd></div><div class="tile"><dt>API 等价费用 · USD</dt><dd class="${cost === null && !pricedTokens ? 'unpriced' : ''}">${cost !== null ? formatUsd(cost) : pricedTokens ? `≥${formatUsd(knownCost)}` : '单价未知'}</dd></div><div class="tile"><dt>连续使用</dt><dd>${streak}<small>天</small></dd></div><div class="tile"><dt>缓存命中</dt><dd>${input ? (cached / input * 100).toFixed(1) : '—'}<small>${input ? '%' : ''}</small></dd></div></dl>
        <div class="status-line">今天 <strong>${formatTokens(todayTokens)}</strong> Token · 本机 <strong>${d.usage.files}</strong> 份会话记录<br>按 OpenAI 官网当前单价回算；这是 API 等价估值，不是订阅账单。${cost === null ? `<br>已计价 ${tokens ? (pricedTokens / tokens * 100).toFixed(1) : 100}% Token，未知单价部分未计入。` : ''}</div>
        <details class="pricing-details"><summary>价格来源与模型明细</summary><p class="note">官网单价核验于 ${time(d.pricing.checkedAt)}。按单次请求区分 ≤272K / &gt;272K 上下文，输入、缓存命中、缓存写入和输出分别计价。</p><button class="text-button" id="pricing-source">查看 OpenAI 官方价格</button>${d.pricing.warning ? `<p class="note">${esc(d.pricing.warning)}</p>` : ''}${d.pricing.customModels.length ? `<p class="note">自定义单价覆盖：${d.pricing.customModels.map(esc).join('、')}</p>` : ''}<p class="note">以下为全部历史。${d.usage.costAssumptions.standardTierEvents ? '日志未记录服务档位的请求按 Standard 价估算。' : ''}${d.usage.costAssumptions.shortContextEvents ? ` ${d.usage.costAssumptions.shortContextEvents} 条增量缺少单次上下文，按短上下文估算。` : ''}${d.usage.costAssumptions.defaultCacheWriteEvents ? ' 缓存写入时长未记录，按默认 30 分钟估算。' : ''}不含工具调用费用及地区附加费。</p><table><thead><tr><th>模型</th><th>Token</th><th>USD 估值</th></tr></thead><tbody>${d.usage.models.map(model => `<tr><td>${esc(model.model)}</td><td>${formatTokens(model.tokens)}</td><td>${model.costUsd === null ? model.knownCostUsd ? `≥${formatUsd(model.knownCostUsd)}` : '未知' : formatUsd(model.costUsd)}</td></tr>`).join('')}</tbody></table></details>
      </section>
    </div><div class="column">
      <section class="section"><div class="section-head"><h2>每日 Token</h2><span class="note">${range === '30' ? '最近 30 天' : '全部'}</span></div><div class="chart" role="img" aria-label="每日 Token 用量趋势">${svg(trendSvg(width, chartDays, false))}</div></section>
      <section class="section"><div class="section-head"><h2>Codex 使用</h2><span class="note">${d.usage.days.filter(day => day.total > 0).length} 个活跃日</span></div>${d.usage.firstDay ? `<div class="chart" role="img" aria-label="Codex 过去一年使用热力图">${svg(usageHeatmapSvg(width, d.usage.days.map(day => ({ day: day.day, tokens: day.total, costUsd: day.costUsd ?? 0 })), d.usage.firstDay, d.today, false))}</div>` : '<div class="empty">还没有找到本机 Codex 使用记录。<br>完成一次 Codex 对话后，小苗就会开始记录成长。</div>'}</section>
      <section class="section"><div class="section-head"><h2>每日合并</h2><span class="note">30 天 ${mergeTotal} 个 PR${gh && !gh.mergesComplete ? '（部分）' : ''}</span></div>${gh ? `<div class="chart" role="img" aria-label="最近30天合并PR与代码行数">${svg(mergesSvg(width, mergeCalendar(gh.merges, addDays(d.today, -29), d.today), false))}</div>` : '<div class="empty">连接 GitHub 后，可以看到每天合并的 PR。</div>'}</section>
      <section class="section"><div class="section-head"><h2>GitHub 贡献</h2><span class="note">${gh ? `过去一年 ${gh.total.toLocaleString()} 次` : ''}</span></div>${gh?.days.length ? `<div class="chart" role="img" aria-label="GitHub 过去一年贡献热力图">${svg(githubHeatmapSvg(width, gh.days[0].day, gh.days.map(day => day.level).join(''), d.today, false))}</div>` : ''}${d.githubStatus ? `<p class="note">${esc(d.githubStatus)}</p>` : ''}</section>
    </div></div>
    <footer><span>本机统计 · ${esc(d.timezone)} · 数据保存在这台电脑</span><span>小苗来自 QingqiShi · Codex 适配版</span></footer>
  </main>`
  if (focus) document.getElementById(focus)?.focus({ preventScroll: true })
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
  if (app) {
    const result = await app.callServerTool({ name, arguments: args })
    if (result.isError) throw new Error(result.content?.find(c => c.type === 'text')?.text ?? '暂时无法读取小苗。')
    return result.structuredContent
  }
  const path = name === 'sprout_interact' ? '/api/interact' : '/api/status'
  const response = await fetch(path + (args.refresh ? '?refresh=1' : ''), path === '/api/interact' ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sprout-Request': '1' }, body: JSON.stringify(args) } : {})
  if (!response.ok) throw new Error('暂时无法读取小苗，请稍后刷新。')
  return response.json()
}
async function refresh(force = false) {
  if (busy) return
  busy = true; render()
  try { dashboard = await call('sprout_status', { refresh: force }); toast = '' }
  catch (error: any) {
    toast = error.message
    if (!dashboard) root.innerHTML = `<main><div class="loading"><strong>小苗暂时没连上</strong><p class="error">${esc(toast)}</p><button id="refresh">重试</button></div></main>`
  } finally { busy = false; render() }
}
root.addEventListener('click', async event => {
  const id = (event.target as HTMLElement).closest('button')?.id
  if (id === 'range30' || id === 'rangeAll') { range = id === 'range30' ? '30' : 'all'; render() }
  if (id === 'refresh') await refresh(true)
  if (id === 'pricing-source' && dashboard) {
    if (app) await app.openLink({ url: dashboard.pricing.sourceUrl })
    else window.open(dashboard.pricing.sourceUrl, '_blank', 'noopener,noreferrer')
  }
  if ((id === 'feed' || id === 'pat') && dashboard && !busy) {
    busy = true; render()
    try {
      dashboard.pet = await call('sprout_interact', { action: id }) as Pet
      toast = id === 'feed' ? '喝到水了，又精神一点。' : '摸摸收到，继续陪你。'
      clearTimeout(actionTimer); actionTimer = setTimeout(render, 1800)
    } catch (error: any) { toast = error.message }
    finally { busy = false; render() }
  }
})
let resize: ReturnType<typeof setTimeout>
window.addEventListener('resize', () => { clearTimeout(resize); resize = setTimeout(render, 120) })
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => { theme = event.matches ? 'dark' : 'light'; document.documentElement.dataset.theme = theme; render() })

async function start() {
  if (embedded) {
    app = new App({ name: 'Sprout Codex', version: '0.2.0' }, {})
    app.ontoolresult = result => { const data = result.structuredContent as Dashboard | undefined; if (data?.version === 1) { dashboard = data; render() } }
    app.onhostcontextchanged = context => { if (context.theme) { theme = context.theme; document.documentElement.dataset.theme = theme; render() } }
    await app.connect()
    const context = app.getHostContext()
    if (context?.theme) { theme = context.theme; document.documentElement.dataset.theme = theme }
  }
  await refresh()
  setInterval(() => { if (!document.hidden) void refresh() }, 60_000)
}
void start().catch(() => { root.innerHTML = '<main><div class="empty">当前客户端未连接小苗面板。可用本地浏览器打开，或重新调用小苗工具。</div></main>' })
