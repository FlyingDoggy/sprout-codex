export type * from '../../../sprout/types'

export type SproutBucket =
  | 'happy'
  | 'worry'
  | 'sleep'
  | 'party'
  | 'feed'
  | 'pat'
  | 'night'
  | 'streak'
  | 'levelup'
  | 'broken'
  | 'pray' | 'reset' | 'cat' | 'overwater' | 'overpat' | 'return'
  | 'busy' | 'planning' | 'compact' | 'agents' | 'test_failed' | 'test_passed'
  | 'done' | 'interrupted' | 'approval'

export type SproutLine = { bucket: SproutBucket; index: number; at: number; roast?: boolean }
