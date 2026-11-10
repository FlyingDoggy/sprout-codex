import type { PersonalityMenu } from '../core/personality'

export function personalityMenu(options: {
  load(): Promise<PersonalityMenu>;
  select(id: string): Promise<void>;
  refresh(): Promise<void>;
}) {
  const menu = document.createElement('div')
  menu.id = 'personality-menu'
  menu.className = 'personality-menu'
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', '人设与刷新')
  menu.hidden = true
  document.body.append(menu)
  let generation = 0
  const anchor = () => document.getElementById('project-menu')
  const buttons = () => [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
  function position() {
    const rect = anchor()?.getBoundingClientRect()
    if (!rect || menu.hidden) return
    menu.style.left = `${Math.max(8, Math.min(rect.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`
    menu.style.top = `${Math.max(8, Math.min(rect.bottom + 8, innerHeight - menu.offsetHeight - 8))}px`
  }
  function close(restoreFocus = false) {
    if (menu.hidden) return
    generation++
    menu.hidden = true
    anchor()?.setAttribute('aria-expanded', 'false')
    if (restoreFocus) anchor()?.focus({ preventScroll: true })
  }
  function note(text: string, role?: string) {
    const element = document.createElement('p')
    element.textContent = text
    if (role) element.setAttribute('role', role)
    menu.append(element)
  }
  async function open() {
    const request = ++generation
    menu.replaceChildren()
    menu.hidden = false
    anchor()?.setAttribute('aria-expanded', 'true')
    note('…')
    position()
    try {
      const state = await options.load()
      if (menu.hidden || request !== generation) return
      menu.replaceChildren()
      note('人设')
      for (const choice of state.choices) {
        const button = document.createElement('button')
        button.type = 'button'
        button.setAttribute('role', 'menuitemradio')
        button.setAttribute('aria-checked', String(choice.id === state.current))
        button.dataset.persona = choice.id
        const label = document.createElement('span')
        label.textContent = choice.name
        const check = document.createElement('span')
        check.setAttribute('aria-hidden', 'true')
        check.textContent = choice.id === state.current ? '✓' : ''
        button.append(label, check)
        menu.append(button)
      }
      const divider = document.createElement('hr')
      const refresh = document.createElement('button')
      refresh.type = 'button'
      refresh.setAttribute('role', 'menuitem')
      refresh.dataset.refresh = 'true'
      refresh.textContent = '刷新'
      menu.append(divider, refresh)
      position()
      menu.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({ preventScroll: true })
    } catch {
      if (menu.hidden || request !== generation) return
      menu.replaceChildren()
      note('暂时无法读取人设', 'status')
      position()
    }
  }
  menu.addEventListener('click', async event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button')
    if (!button || button.disabled) return
    if (button.dataset.refresh) { close(true); await options.refresh(); return }
    if (!button.dataset.persona) return
    if (button.getAttribute('aria-checked') === 'true') { close(true); return }
    const request = generation
    buttons().forEach(item => { item.disabled = true })
    menu.querySelector('[role="status"]')?.remove()
    try {
      await options.select(button.dataset.persona)
      if (request === generation) close(true)
    } catch {
      if (menu.hidden || request !== generation) return
      menu.querySelectorAll<HTMLButtonElement>('button').forEach(item => { item.disabled = false })
      note('切换失败，请重试', 'status')
      button.focus({ preventScroll: true })
      position()
    }
  })
  document.addEventListener('pointerdown', event => {
    const target = event.target as Node
    if (!menu.contains(target) && !anchor()?.contains(target)) close()
  })
  document.addEventListener('keydown', event => {
    if (menu.hidden) return
    if (event.key === 'Escape') { event.preventDefault(); close(true); return }
    if (event.key === 'Tab') { close(true); return }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const items = buttons()
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus({ preventScroll: true })
  })
  window.addEventListener('resize', position)
  document.addEventListener('scroll', position, true)
  return { isOpen: () => !menu.hidden, position, close, toggle: () => menu.hidden ? open() : close(true) }
}
