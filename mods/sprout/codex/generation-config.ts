export type GenerationSettings = {
  enabled: boolean; provider: 'codex'; model: string; binary?: string
  minIntervalMs: number; maxBatchesPerDay: number; timeoutMs: number
}

export function generationSettings(value: unknown): GenerationSettings {
  const defaults: GenerationSettings = { enabled: false, provider: 'codex', model: 'gpt-6-luna', minIntervalMs: 900_000, maxBatchesPerDay: 12, timeoutMs: 45_000 }
  if (value === undefined) return defaults
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid generation settings')
  const s = { ...defaults, ...value } as GenerationSettings
  if (typeof s.enabled !== 'boolean' || s.provider !== 'codex' || typeof s.model !== 'string' || !s.model.trim() || s.model.length > 100 ||
    (s.binary !== undefined && (typeof s.binary !== 'string' || !s.binary.trim()))) throw new Error('Invalid provider')
  for (const [n, min, max] of [[s.minIntervalMs, 60_000, 86_400_000], [s.maxBatchesPerDay, 1, 100], [s.timeoutMs, 1000, 60_000]]) {
    if (!Number.isSafeInteger(n) || n! < min! || n! > max!) throw new Error('Invalid generation budget')
  }
  return s
}
