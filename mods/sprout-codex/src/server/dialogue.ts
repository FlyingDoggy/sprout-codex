import type { Dashboard } from '../model'
import { personaPools } from '../core/personality'
import { loadPersonality } from './personality-config'

/** This branch only decorates dashboards with static local dialogue. */
export class DialogueEngine {
  constructor(readonly dataDir: string) {}
  async decorate(d: Dashboard): Promise<Dashboard> {
    try {
      const { pack, revision } = await loadPersonality(this.dataDir)
      return { ...d, dialogue: { personaId: pack.id, revision, pools: personaPools(pack, d.task) } }
    } catch { return d }
  }
}
