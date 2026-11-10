import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { z } from 'zod'
import { formatTokens } from '../core/logic'
import type { DashboardService } from './http'

export function createMcpServer(service: DashboardService, html: string) {
  const server = new McpServer({ name: 'sprout-codex', version: '0.3.0' })
  const uri = 'ui://sprout/dashboard-v2.html'
  registerAppTool(server, 'sprout_status', {
    title: '打开小苗', description: '查看本机 Codex 用量、订阅额度、GitHub 贡献和像素宠物；在兼容客户端打开交互面板。从本机日志提取用量字段，只返回汇总数据，不返回对话正文。',
    inputSchema: { refresh: z.boolean().optional().describe('重新扫描本机会话记录；额度查询有一分钟缓存。') },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    _meta: { ui: { resourceUri: uri }, 'openai/ui': { entrypoints: [{ type: 'thread' }, { type: 'global' }] } },
  }, async ({ refresh }: { refresh?: boolean }) => {
    try {
      const data = await service.get(refresh)
      return { content: [{ type: 'text', text: `小苗 Lv${data.pet.highest}。本机累计 ${formatTokens(data.usage.totals.total)} Token，${data.usage.days.length} 个有记录的使用日。额度：${data.quota.windows.map(w => `${w.label} 已用 ${Math.round(w.usedPercent)}%`).join('；') || '暂无读数'}。${data.demo ? '当前为演示数据。' : '统计仅覆盖本机保留的 Codex 会话。'}` }], structuredContent: { ...data } }
    } catch { return { isError: true, content: [{ type: 'text', text: '无法读取本机统计，请检查会话目录和数据目录权限。' }] } }
  })
  registerAppTool(server, 'sprout_interact', {
    title: '陪陪小苗', description: '给小苗喂水、摸摸，或让它再嘴一句。',
    inputSchema: { action: z.enum(['feed', 'pat', 'roast']) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { resourceUri: uri, visibility: ['app', 'model'] } },
  }, async ({ action }: { action: 'feed' | 'pat' | 'roast' }) => {
    const pet = await service.interact(action)
    return { content: [{ type: 'text', text: action === 'feed' ? '小苗喝到水了。' : action === 'pat' ? '小苗收到摸摸。' : '小苗又有话说了。' }], structuredContent: { ...pet } }
  })
  registerAppResource(server, '小苗面板', uri, {}, async () => ({ contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: html, _meta: { ui: { prefersBorder: false } } }] }))
  return server
}
export async function runMcp(service: DashboardService, html: string) {
  await createMcpServer(service, html).connect(new StdioServerTransport())
}
