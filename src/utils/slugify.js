// Turns a dish or city name into a file-name slug: lowercase ASCII, hyphens.
// Letters that don't decompose into base + accent get spelled out first, so
// đ → dj (Karađorđeva → karadjordjeva), æ → ae, ø → o (Smørrebrød → smorrebrod).
const SPELLED = { đ: 'dj', æ: 'ae', ø: 'o', ß: 'ss', œ: 'oe', ł: 'l', ı: 'i', þ: 'th', ð: 'd' }

export function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[đæøßœłıþð]/g, c => SPELLED[c])
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
