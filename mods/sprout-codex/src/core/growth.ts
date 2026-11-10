import type { Dashboard } from '../model'
import { LEVELS, levelInfo } from './levels'
import { addDays } from './logic'

export const LEVEL_DESCRIPTIONS = [
  '半截埋在土里，只露出一根芽尖，偷偷看你。',
  '整只钻出土，两片细叶子，小小一只。',
  '叶子变大变肥，个头也长了一圈。',
  '顶上鼓起一个粉色花苞，憋着要开。',
  '花开了，第一个大里程碑。',
  '花旁挂上小红果，长得越来越热闹。',
  '头顶长成一棵树，来了只小蓝鸟定居。',
  '满树樱花，花瓣一直往下飘。',
  '金叶子、头顶光环、全身发光，终极形态。',
] as const

export function growthCards(d: Dashboard) {
  const tokens = d.usage.totals.total
  const current = levelInfo(d.pet.highest).lv
  const from = addDays(d.today, -6)
  const daily = d.usage.days.filter(day => day.day >= from && day.day <= d.today).reduce((sum,day)=>sum+day.total,0) / 7
  const eta = (target: number) => daily > 0 ? Math.max(1, Math.ceil((target-tokens)/daily)) : null
  return LEVELS.map((level,index) => {
    const next = LEVELS[index+1]
    const status = level.lv < current ? 'unlocked' : level.lv === current ? 'current' : 'locked'
    return { ...level, description:LEVEL_DESCRIPTIONS[index], status, tokens,
      target:next ? next.thresholdB*1e9 : null,
      progress:next ? Math.min(1,Math.max(0,(tokens-level.thresholdB*1e9)/((next.thresholdB-level.thresholdB)*1e9))) : 1,
      etaDays:status==='locked' ? eta(level.thresholdB*1e9) : status==='current' && next ? eta(next.thresholdB*1e9) : null }
  })
}

export function etaText(days: number | null) {
  if (days === null) return ''
  if (days < 60) return `约 ${days} 天后`
  if (days < 365) return `约 ${Math.round(days/30)} 个月后`
  return `约 ${(days/365).toFixed(1)} 年后`
}
