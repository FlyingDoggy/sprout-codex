import { createServer, type IncomingMessage } from 'node:http'
import type { Dashboard, Pet } from '../model'

export type DashboardService = { get(force?: boolean): Promise<Dashboard>; interact(action: 'feed' | 'pat' | 'roast'): Promise<Pet> }

export async function serve(service: DashboardService, html: string, port: number) {
  const server = createServer(async (req, res) => {
    const address = server.address()
    const boundPort = typeof address === 'object' && address ? address.port : port
    const host = `127.0.0.1:${boundPort}`
    const origin = `http://${host}`
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
    const json = (status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)) }
    if (req.headers.host !== host || req.headers.origin && req.headers.origin !== origin) { json(403, { error: '仅允许本机同源访问。' }); return }
    const url = new URL(req.url ?? '/', origin)
    try {
      if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); return }
      if (req.method === 'GET' && url.pathname === '/api/status') { json(200, await service.get(url.searchParams.get('refresh') === '1')); return }
      if (req.method === 'POST' && url.pathname === '/api/interact') {
        if (req.headers['x-sprout-request'] !== '1' || !req.headers['content-type']?.startsWith('application/json')) { json(403, { error: '请求来源不受支持。' }); return }
        const body = await readBody(req)
        if (body.action !== 'feed' && body.action !== 'pat' && body.action !== 'roast') { json(400, { error: '未知的小苗动作。' }); return }
        json(200, await service.interact(body.action)); return
      }
      json(404, { error: '页面不存在。' })
    } catch { json(500, { error: '小苗暂时无法读取数据，请检查本机目录与权限。' }) }
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  return server
}

async function readBody(req: IncomingMessage) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (Buffer.byteLength(body) > 1024) throw new Error('Request too large')
  }
  return JSON.parse(body)
}
