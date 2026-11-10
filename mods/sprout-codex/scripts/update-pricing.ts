import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fetchOfficialPrices, parseOfficialPrices } from '../src/server/pricing'

const index = process.argv.indexOf('--source-file')
const catalog = index >= 0 ? parseOfficialPrices(await readFile(process.argv[index + 1], 'utf8')) : await fetchOfficialPrices()
await mkdir('src/data', { recursive: true })
await writeFile('src/data/openai-prices.json', JSON.stringify(catalog, null, 2) + '\n')
console.log(`Updated ${Object.keys(catalog.models).length} models from ${catalog.sourceUrl}`)
