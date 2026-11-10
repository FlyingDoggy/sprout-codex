import { TASK_SCENARIOS, type TaskContext, type TaskScenario, type TaskSignal } from './personas'

const rules: Record<TaskScenario, RegExp> = {
  general: /$^/,
  slides: /\bpptx?\b|powerpoint|幻灯片|母版|排版|第\s*\d+\s*页|这一页|页面布局/gi,
  commercial: /报价|工时|尾款|合同|采购|投标|scope|交付范围|增项|不含税|含税|税率/gi,
  media: /视频|口播|配音|字幕|分镜|演示片|录屏/gi,
  teaching: /教学|课程|教案|大纲|讲解|听不懂|没听懂|没搞清楚|越讲.*越晕|更懵|发展阶段|学习计划/gi,
  research: /调研|核查|研究|查证|文献|论文|出处|来源|采访/gi,
  consulting: /方案|架构|白皮书|访谈|纪要|业务|咨询|能力图|周报|ontology|本体|知识图谱/gi,
  coding: /代码|\b(?:bug|git|commit|npm|pytest|api|react|typescript)\b|单元测试|编译|函数|接口实现|插件|分支|再嘴一句|台词|人设/gi,
  personal: /护肤|修容|体检|财务|账单|旅行|健身/gi,
}
const signals: Record<TaskSignal, RegExp> = {
  scope: /加需求|加一项|顺手做|顺手加|增项|范围.*(?:增加|扩大)/,
  layout: /别.*(?:重画|重排|布局)|不要.*(?:重画|重排|布局)|只改.*页|单独更新.*页|原版.*布局|母版|排版|字号/,
  wording: /AI[味腔]|废话|说人话|wording|措辞|术语|赋能|写那么多|改.*文案/i,
  evidence: /证据|核查|出处|查证|强行修改|不要.*(?:硬编|编造|强行)/,
  review: /审阅|审稿|验收|评审|review|先.*(?:看看|预览)/i,
  architecture: /架构|TOGAF|职责|系统边界|技术边界|能力图/i,
  knowledge: /ontology|wiki|\bRAG\b|本体|知识图谱|知识库/i,
  artifact: /可编辑|原生.*(?:PPT|图形|表格)|完整.*(?:材料|文件)|交付文件|输出.*(?:pptx|xlsx)|html.*(?:ppt|pdf)|ppt.*(?:html|pdf)/i,
  autonomy: /别.*(?:问|确认)|不要.*(?:问|确认)|直接.*(?:开工|做|推送)|又问|反复确认/,
  dialogue: /台词|再嘴一句|人设|personality|嘴臭|喂水|摸摸/i,
}

/** Desktop messages include injected user-role context; classify only the actual request. */
export function userRequest(record: any): string | undefined {
  const p = record.payload
  let parts: string[]
  if (record.type === 'event_msg' && p?.type === 'user_message' && typeof p.message === 'string') parts = [p.message]
  else if (record.type === 'response_item' && p?.type === 'message' && p.role === 'user' && Array.isArray(p.content)) {
    parts = p.content.filter((part: any) => part.type === 'input_text' && typeof part.text === 'string').map((part: any) => part.text)
  } else return
  const text = parts.map(part => {
    if (/^\s*(?:# AGENTS\.md instructions|<INSTRUCTIONS>|<environment_context>|<turn_aborted>|<subagent_notification>)/i.test(part)) return ''
    const request = part.includes('## My request:') ? part.slice(part.indexOf('## My request:') + '## My request:'.length) : part
    return request.replace(/<image\b[^>]*>[\s\S]*?<\/image>|<\/?image\b[^>]*>/gi, '')
      .replace(/```[^]*?```/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  }).join('\n').trim()
  return text || undefined
}

/** Classify locally; the text is transient. Only these closed-set labels survive. */
export function classifyTask(text: string, at: number, previous?: TaskContext): TaskContext {
  const sample = text.slice(-8000)
  const ranked = TASK_SCENARIOS.filter(s => s !== 'general').map(scenario => ({ scenario, score: [...sample.matchAll(rules[scenario])].length })).sort((a,b) => b.score-a.score)
  const top = ranked[0]?.score ?? 0
  const tiedPrevious = ranked.find(r => r.scenario === previous?.scenario && r.score === top)
  const scenario = top ? (tiedPrevious ?? ranked[0]).scenario : previous?.scenario ?? 'general'
  const detected = (Object.entries(signals) as [TaskSignal, RegExp][]).filter(([signal,rule]) => (signal !== 'artifact' || scenario === 'slides') && rule.test(sample)).map(([signal]) => signal)
  // "可以，继续" must not erase the layout/evidence constraints of the current work.
  const continuing = /^(?:可以|好[的啊]?|行|嗯|继续|没问题|开工|开始|合进去|更新|就这样|按这个来)[\s，,。.!！]*(?:继续|吧|做吧|开工|合进去吧)?[\s，,。.!！]*$/.test(sample.trim())
  return { scenario, signals: detected.length ? detected : continuing && scenario === previous?.scenario ? previous.signals : [], at }
}
