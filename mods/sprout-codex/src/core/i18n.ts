export type Lang = 'zh' | 'en'
let current: Lang = 'zh'
export function setLang(next: Lang) { current = next }
export function lang() { return current }
export function t(zh: string, en: string) { return current === 'zh' ? zh : en }
