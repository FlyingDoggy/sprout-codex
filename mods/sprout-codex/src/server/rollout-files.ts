import { createReadStream } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createZstdDecompress } from 'node:zlib'

export async function* walkRollouts(root: string): AsyncGenerator<string> {
  let entries
  try { entries = await readdir(root, { withFileTypes: true }) } catch (error: any) {
    if (error.code === 'ENOENT') return
    throw error
  }
  for (const item of entries) {
    const path = join(root, item.name)
    if (item.isDirectory()) yield* walkRollouts(path)
    else if (item.isFile() && /\.jsonl(?:\.zst)?$/.test(item.name)) yield path
  }
}

/** Bounded memory even for huge inline images. Incomplete trailing lines wait for the next read. */
export async function* rolloutLines(path: string, start = 0, end?: number): AsyncGenerator<{ line: string; offset: number }> {
  const input = createReadStream(path, { start, ...(end === undefined ? {} : { end }), highWaterMark: 256 * 1024 })
  const stream = path.endsWith('.zst') ? input.pipe(createZstdDecompress()) : input
  if (stream !== input) input.on('error', error => stream.destroy(error))
  let fragments: Buffer[] = [], bytes = 0, offset = start, skipped = false
  try {
    for await (const raw of stream) {
      const chunk = raw as Buffer
      let from = 0
      for (;;) {
        const end = chunk.indexOf(10, from)
        const part = chunk.subarray(from, end < 0 ? chunk.length : end)
        bytes += part.length
        if (bytes > 16 * 1024 * 1024) { fragments = []; skipped = true }
        if (!skipped) fragments.push(part)
        if (end < 0) break
        offset += bytes + 1
        yield { line: skipped ? '' : Buffer.concat(fragments, bytes).toString('utf8'), offset }
        fragments = []; bytes = 0; skipped = false; from = end + 1
      }
    }
  } finally { stream.destroy(); input.destroy() }
}
