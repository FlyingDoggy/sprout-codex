import type { Dashboard } from '../model'
import { growthCards, etaText } from '../core/growth'
import { formatTokens } from '../core/logic'
import { portraitSvg } from '../core/scene'
import { esc } from '../core/svg-kit'

let dialog: HTMLDialogElement | undefined
function cards(d: Dashboard) {
  const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:d.timezone,hour:'2-digit',hourCycle:'h23'}).format(Date.now()))
  return growthCards(d).map(card=>`<article class="growth-card ${card.status}">
    <div class="growth-portrait" aria-label="Lv${card.lv} ${esc(card.name)}">${portraitSvg(card.lv,hour>=7&&hour<19)}</div>
    <div class="growth-title"><h3>Lv${card.lv} ${esc(card.name)}</h3><span>${card.thresholdB?`累计 ${card.thresholdB}B`:'起点'}</span></div>
    <p>${card.description}</p>
    ${card.status==='current' ? `<span class="growth-badge current">当前 · ${formatTokens(card.tokens)}${card.target?` / ${formatTokens(card.target)}`:' · 已满级'}</span><progress value="${card.progress}" max="1" aria-label="到下一等级的进度"></progress>${card.etaDays ? `<p class="growth-eta">按最近 7 天的速度，${etaText(card.etaDays)}升级</p>`:''}` : `<span class="growth-badge ${card.status}">${card.status==='unlocked'?'已解锁':etaText(card.etaDays)||'尚未解锁'}</span>`}
  </article>`).join('')
}

export function refreshGrowth(d: Dashboard) {
  if (dialog?.open) dialog.querySelector('.growth-grid')!.innerHTML=cards(d)
}

export function openGrowth(d: Dashboard) {
  if (!dialog) {
    dialog=document.createElement('dialog')
    dialog.className='growth-dialog';dialog.setAttribute('aria-labelledby','growth-title')
    dialog.innerHTML='<div class="growth-heading"><h2 id="growth-title">成长图鉴</h2><button type="button" aria-label="关闭图鉴">×</button></div><div class="growth-grid"></div>'
    document.body.append(dialog)
    dialog.querySelector('button')!.addEventListener('click',()=>dialog!.close())
    dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog!.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog!.close()}})
    dialog.addEventListener('close',()=>document.querySelector<SVGElement>('[data-action="gallery"]')?.focus({preventScroll:true}))
  }
  if (!dialog.open) dialog.showModal()
  refreshGrowth(d)
}
