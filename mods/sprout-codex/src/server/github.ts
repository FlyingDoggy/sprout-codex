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

export async function readGithub(timezone: string, now = Date.now()): Promise<GithubData> {
  const initial = await graphql('query { viewer { login contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date contributionLevel } } } } } }')
  const calendar = initial.viewer.contributionsCollection.contributionCalendar
  const levels: Record<string, number> = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 }
  const days = calendar.weeks.flatMap((week: any) => week.contributionDays.map((day: any) => ({ day: day.date, level: levels[day.contributionLevel] ?? 0 })))
  const today = dayAt(now, timezone)
  const from = addDays(today, -29)
  const query = 'query($q:String!, $after:String) { search(query:$q, type:ISSUE, first:100, after:$after) { pageInfo { hasNextPage endCursor } nodes { ... on PullRequest { mergedAt additions deletions } } } }'
  const merges = new Map<string, { day: string; prs: number; additions: number; deletions: number }>()
  let cursor: string | undefined
  let complete = false
  for (let page = 0; page < 10; page++) {
    const result = await graphql(query, { q: `is:pr is:merged author:${initial.viewer.login} merged:>=${addDays(from, -1)}`, ...(cursor ? { after: cursor } : {}) })
    for (const pr of result.search.nodes) {
      if (!pr.mergedAt) continue
      const day = dayAt(Date.parse(pr.mergedAt), timezone)
      if (day < from || day > today) continue
      const row = merges.get(day) ?? { day, prs: 0, additions: 0, deletions: 0 }
      row.prs++; row.additions += pr.additions; row.deletions += pr.deletions
      merges.set(day, row)
    }
    if (!result.search.pageInfo.hasNextPage) { complete = true; break }
    cursor = result.search.pageInfo.endCursor
  }
  return { fetchedAt: now, total: calendar.totalContributions, days, merges: [...merges.values()].sort((a, b) => a.day.localeCompare(b.day)), mergesComplete: complete }
}
