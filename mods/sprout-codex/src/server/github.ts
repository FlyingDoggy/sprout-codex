import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dayAt, type GithubData } from '../model'
import { addDays } from '../core/logic'

const run = promisify(execFile)
async function graphql(query: string, variables: Record<string, string> = {}): Promise<any> {
  const args = ['api', '--hostname', 'github.com', 'graphql', '-f', `query=${query}`]
  for (const [key, value] of Object.entries(variables)) args.push('-f', `${key}=${value}`)
  const { stdout } = await run('gh', args, { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 })
  const result = JSON.parse(stdout)
  if (result.errors) throw new Error('GitHub 数据暂不可用。')
  return result.data
}

export async function readGithub(timezone: string, now = Date.now(), historyFrom?: string, request = graphql): Promise<GithubData> {
  const initial = await request('query { viewer { login contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date contributionLevel } } } } } }')
  const calendar = initial.viewer.contributionsCollection.contributionCalendar
  const levels: Record<string, number> = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 }
  const days = calendar.weeks.flatMap((week: any) => week.contributionDays.map((day: any) => ({ day: day.date, level: levels[day.contributionLevel] ?? 0 })))
  const today = dayAt(now, timezone)
  const from = historyFrom ?? addDays(today, -29)
  const query = 'query($q:String!, $after:String) { search(query:$q, type:ISSUE, first:100, after:$after) { issueCount pageInfo { hasNextPage endCursor } nodes { ... on PullRequest { id number mergedAt additions deletions } } } }'
  const merges = new Map<string, { day: string; prs: number; additions: number; deletions: number }>()
  let latestMerge: GithubData['latestMerge'] = null
  let cursor: string | undefined
  let complete = false
  const seen = new Set<string>()
  let received = 0
  for (let page = 0; page < 10; page++) {
    const result = await request(query, { q: `is:pr is:merged author:${initial.viewer.login} merged:>=${addDays(from, -1)} sort:updated-desc`, ...(cursor ? { after: cursor } : {}) })
    for (const pr of result.search.nodes) {
      if (!pr.mergedAt) continue
      const key = String(pr.id ?? `${pr.number}:${pr.mergedAt}`)
      if (seen.has(key)) continue
      seen.add(key); received++
      const at = Date.parse(pr.mergedAt)
      if (!latestMerge || at > latestMerge.at) latestMerge = { number: pr.number, at }
      const day = dayAt(Date.parse(pr.mergedAt), timezone)
      if (day < from || day > today) continue
      const row = merges.get(day) ?? { day, prs: 0, additions: 0, deletions: 0 }
      row.prs++; row.additions += pr.additions; row.deletions += pr.deletions
      merges.set(day, row)
    }
    if (!result.search.pageInfo.hasNextPage) { complete = Number.isFinite(result.search.issueCount) && received >= result.search.issueCount; break }
    cursor = result.search.pageInfo.endCursor
    if (!cursor) break
  }
  if (!complete) {
    // updated-desc is not merged-desc. A truncated result cannot identify the latest merge.
    latestMerge = null
    try {
      const recent = await request(query, { q: `is:pr is:merged author:${initial.viewer.login} merged:>=${new Date(now - 6 * 3_600_000).toISOString()} sort:updated-desc` })
      if (!recent.search.pageInfo.hasNextPage && recent.search.issueCount <= recent.search.nodes.length) {
        for (const pr of recent.search.nodes) {
          const at = Date.parse(pr.mergedAt)
          if (Number.isFinite(at) && at <= now && (!latestMerge || at > latestMerge.at)) latestMerge = { number: pr.number, at }
        }
      }
    } catch { /* Historical statistics remain useful even if the small recent query fails. */ }
  }
  return { fetchedAt: now, total: calendar.totalContributions, days, merges: [...merges.values()].sort((a, b) => a.day.localeCompare(b.day)), mergesFrom: from, latestMerge, mergesComplete: complete }
}
