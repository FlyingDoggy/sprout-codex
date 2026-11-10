export * from '../../../sprout/hooks/panels'
import { tilesSvg as sharedTiles, type TilesInput } from '../../../sprout/hooks/panels'
export function tilesSvg(input: TilesInput) { return sharedTiles({ ...input, numberWeight: 600, labelWeight: 500 }) }
