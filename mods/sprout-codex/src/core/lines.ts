import type { SproutBucket } from '../types'
import { lang } from './i18n'
import { LINES as ORIGINAL, LINES_EN as ORIGINAL_EN, fill, type LineContext as OriginalContext } from '../../../sprout/hooks/lines'
import { CODEX_LINES, CODEX_LINES_EN } from './codex-lines'
export { fill }
export type LineContext = OriginalContext & { agents?: number; failures?: number }

function adapted(base: typeof ORIGINAL, zh: boolean) {
  const pools = Object.fromEntries(Object.entries(base).map(([bucket, lines]) => [bucket,
    lines.flatMap(line => {
      const text = line.replaceAll('Claude', 'Codex').replaceAll('Anthropic', 'OpenAI')
        .replace('5 小时额度见底', '额度见底').replace('5-hour limit hit', 'Quota limit hit')
      return text === '别戳我，戳我也长不出额度来。' || text === "Don't poke me. Poking won't grow more quota."
        ? [text, zh ? '你摸的是我，不是 Tibo 的 reset 按钮。' : 'You are patting me, not Tibo’s reset button.'] : [text]
    })])) as Record<keyof typeof ORIGINAL, string[]>
  pools.happy.push(...(zh ? ['再来一次？你俩是真他妈不信邪。', '让它改个按钮，别让这傻逼把祖坟都重构了。', '我骂你可以，它凭什么让你受这气？']
    : ['Try again? You two really do not learn, damn it.', 'One button. Do not let that idiot refactor the ancestors.', 'I get to roast you. It does not get to waste your day.']))
  pools.night.push(zh ? '这轮跑完就睡。我替你看着这傻逼。' : 'Finish this round, then sleep. I will watch that idiot.')
  return pools
}
export const LINES: Record<SproutBucket, readonly string[]> = { ...CODEX_LINES, ...adapted(ORIGINAL, true) }
export const LINES_EN: Record<SproutBucket, readonly string[]> = { ...CODEX_LINES_EN, ...adapted(ORIGINAL_EN, false) }

export function linesFor(buckets: readonly SproutBucket[], context: LineContext) {
  const out: { bucket: SproutBucket; text: string }[] = []
  for (const bucket of buckets) {
    for (const line of (lang() === 'zh' ? LINES : LINES_EN)[bucket]) {
      const text = fill(line, context)
      if (text !== null) out.push({ bucket, text })
    }
  }

  return out
}
