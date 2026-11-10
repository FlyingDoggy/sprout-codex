import { TASK_SCENARIOS, type TaskContext, type TaskScenario, type TaskSignal } from '../core/personality'

const rules: Record<TaskScenario, RegExp> = {
  general: /$^/,
  slides: /\bpptx?\b|powerpoint|幻灯片|母版|排版|第\s*\d+\s*页|页面布局/gi,
  commercial: /报价|工时|尾款|合同|采购|投标|scope|交付范围|增项/gi,
  media: /视频|口播|配音|字幕|分镜|演示片|录屏/gi,
  teaching: /教学|课程|教案|大纲|讲解|听不懂|没听懂|学习计划/gi,
  research: /调研|核查|研究|查证|文献|论文|出处|来源|采访/gi,
  consulting: /方案|架构|白皮书|访谈|纪要|业务|咨询|能力图|周报/gi,
  coding: /代码|\b(?:bug|git|commit|npm|pytest|api|react|typescript)\b|单元测试|编译|函数|接口实现/gi,
  personal: /护肤|修容|体检|财务|账单|旅行|健身/gi,
}
const signals: Record<TaskSignal, RegExp> = {
  scope: /加需求|加一项|顺手做|顺手加|增项|范围.*(?:增加|扩大)/,
  layout: /别.*(?:重画|重排|布局)|不要.*(?:重画|重排|布局)|只改.*页|原版.*布局|母版/,
  wording: /AI[味腔]|废话|说人话|不要.*(?:措辞|术语|赋能)|写那么多/,
  evidence: /证据|核查|出处|查证|强行修改|不要.*(?:硬编|编造|强行)/,
  review: /审阅|审稿|验收|评审|review|先.*(?:看看|预览)/i,
}

/** Classify locally; the text is transient. Only these closed-set labels survive. */
export function classifyTask(text: string, at: number, previous?: TaskContext): TaskContext {
  const sample = text.slice(-8000)
  const ranked = TASK_SCENARIOS.filter(s => s !== 'general').map(scenario => ({ scenario, score: [...sample.matchAll(rules[scenario])].length })).sort((a,b) => b.score-a.score)
  const scenario = ranked[0]?.score ? ranked[0].scenario : previous?.scenario ?? 'general'
  return { scenario, signals: (Object.entries(signals) as [TaskSignal, RegExp][]).filter(([,rule]) => rule.test(sample)).map(([signal]) => signal), at }
}
