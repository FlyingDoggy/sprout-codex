import manifest from '../../package.json'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { z } from 'zod'
import { fileURLToPath } from 'node:url'
import { panelContext } from './context'
import { formatTokens } from '../core/logic'
import type { DashboardService } from './http'
import { PET_ACTIONS, type PanelContext, type PetAction } from '../model'

export function createMcpServer(service: DashboardService, html: string) {
  const server = new McpServer({ name: 'sprout-codex', version: manifest.version })
  const uri = 'ui://sprout/dashboard-personality-v3.html'
  const contextSchema = { cwd: z.string().max(4096).optional().describe('当前聊天的项目工作目录，用于右上角显示文件夹名。'), threadId: z.string().max(200).optional().describe('当前聊天 ID；面板刷新时保留。') }
  async function contextOf(args: PanelContext, meta?: Record<string, unknown>) {
    const context = panelContext(args, meta)
    if (!context.threadId && !context.cwd && server.server.getClientCapabilities()?.roots) {
      try {
        const { roots } = await server.server.listRoots(undefined, { timeout: 1000 })
        if (roots.length === 1 && roots[0].uri.startsWith('file://')) context.cwd = fileURLToPath(roots[0].uri)
      } catch {}
    }
    return context
  }
  registerAppTool(server, 'sprout_status', {
    title: '打开小苗', description: '查看本机 Codex 用量、订阅额度、GitHub 贡献和像素宠物；在兼容客户端打开交互面板。从本机日志提取用量字段，只返回汇总数据，不返回对话正文。',
    inputSchema: { refresh: z.boolean().optional().describe('重新扫描本机会话记录；额度查询有一分钟缓存。'), ...contextSchema },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    _meta: { ui: { resourceUri: uri }, 'openai/ui': { entrypoints: [{ type: 'thread' }, { type: 'global' }] } },
  }, async (args: PanelContext & { refresh?: boolean }, extra: { _meta?: Record<string, unknown> }) => {
    try {
      const data = await service.get(args.refresh, await contextOf(args, extra._meta))
      return { content: [{ type: 'text', text: `小苗 Lv${data.pet.highest}。本机累计 ${formatTokens(data.usage.totals.total)} Token，${data.usage.days.length} 个有记录的使用日。额度：${data.quota.windows.map(w => `${w.label} 已用 ${Math.round(w.usedPercent)}%`).join('；') || '暂无读数'}。${data.demo ? '当前为演示数据。' : '统计仅覆盖本机保留的 Codex 会话。'}` }], structuredContent: { ...data } }
    } catch { return { isError: true, content: [{ type: 'text', text: '无法读取本机统计，请检查会话目录和数据目录权限。' }] } }
  })
  registerAppTool(server, 'sprout_interact', {
    title: '陪陪小苗', description: '给小苗喂水、摸摸、再嘴一句，向 Tibo 求雨，或和 CatGPT 打招呼。求雨只播放宠物互动。',
    inputSchema: { action: z.enum(PET_ACTIONS), ...contextSchema },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { resourceUri: uri, visibility: ['app', 'model'] } },
  }, async (args: PanelContext & { action: PetAction }, extra: { _meta?: Record<string, unknown> }) => {
    const { action } = args
    const pet = await service.interact(action, await contextOf(args, extra._meta))
    const text = { feed: '小苗喝到水了。', pat: '小苗收到摸摸。', roast: '小苗又有话说了。', pray: '小苗开始向 Tibo 求雨。', cat: 'CatGPT 来串门了。' }[action]
    return { content: [{ type: 'text', text }], structuredContent: { ...pet } }
  })
  registerAppTool(server, 'sprout_personality', {
    title: '切换小苗人设', description: '列出本机人设，或选择一个人设并立即刷新台词。',
    inputSchema: { persona: z.string().regex(/^[a-z0-9_-]{1,60}$/).optional(), ...contextSchema },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { resourceUri: uri, visibility: ['app'] } },
  }, async (args: PanelContext & { persona?: string }, extra: { _meta?: Record<string, unknown> }) => {
    try {
      const data = args.persona ? await service.selectPersonality(args.persona, await contextOf(args, extra._meta)) : await service.personalities()
      return { content: [], structuredContent: { ...data } }
    } catch { return { isError: true, content: [{ type: 'text', text: '无法切换，请检查人设文件。' }] } }
  })
  registerAppResource(server, '小苗面板', uri, {}, async () => ({ contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: html, _meta: { ui: { prefersBorder: false } } }] }))
  return server
}
export async function runMcp(service: DashboardService, html: string) {
  await createMcpServer(service, html).connect(new StdioServerTransport())
}
