export * from '../../../sprout/hooks/scene'
import { sceneSvg as sharedScene, type SceneInput as SharedSceneInput } from '../../../sprout/hooks/scene'
import { extrasCss, extrasSvg, rainSvg, type SceneExtras } from './scene-extras'
export type SceneInput = SharedSceneInput & SceneExtras
export function sceneSvg(input: SceneInput) {
  return sharedScene({ ...input, decoration: {
    css: extrasCss,
    bodyClass: input.effect === 'pray' ? 'party' : undefined,
    belowPet: id => input.effect === 'rain' ? rainSvg(input.width, id) : '',
    abovePet: (layout, id) => extrasSvg(input, layout, id),
    pet: (markup, id) => input.effect === 'hide' || input.effect === 'return'
      ? `<g clip-path="url(#soil-${id})"><g class="${input.effect}-${id}" data-effect="${input.effect}">${markup}</g></g>` : markup,
    level: (markup, x, width) => `<g class="scene-hotspot" data-action="gallery" role="button" tabindex="0" aria-label="查看成长图鉴"><title>成长图鉴</title>${markup}<rect class="hit-area" x="${x}" y="128" width="${width.toFixed(2).replace(/\.?0+$/, '')}" height="22" rx="2" fill="transparent"/></g>`,
  } })
}
