// Words tier: the locked editorial structure (see words-contentful-spec.md).
// Contentful stores a validated `slot` per word; category, label, and order are
// all derived here in the app — code enforces the order, Contentful the vocab.

export const WORD_SLOTS = [
  // Coming & going
  'greeting-morning', 'greeting-afternoon', 'greeting-evening', 'greeting-casual', 'leaving',
  // The basics
  'please', 'thanks', 'yes', 'no',
  // Language
  'speak-english', 'dont-speak', 'dont-understand',
  // Apology & passage
  'sorry', 'excuse-attention', 'excuse-passing',
  // Numbers
  'number-one', 'number-two', 'number-three', 'number-four',
  // At the table
  'table-for', 'menu', 'id-like-this', 'enjoy-meal', 'cheers', 'delicious', 'check', 'money-surprise',
  // Out and about
  'where-is', 'ticket', 'bathroom', 'door-men', 'door-women', 'atm',
  // Shopping
  'how-much', 'card', 'cash', 'bag',
  // Deep cuts
  'deep-cut',
]

export const SLOT_CATEGORY = {
  'greeting-morning': 'coming-going', 'greeting-afternoon': 'coming-going',
  'greeting-evening': 'coming-going', 'greeting-casual': 'coming-going', 'leaving': 'coming-going',
  'please': 'basics', 'thanks': 'basics', 'yes': 'basics', 'no': 'basics',
  'speak-english': 'language', 'dont-speak': 'language', 'dont-understand': 'language',
  'sorry': 'apology-passage', 'excuse-attention': 'apology-passage', 'excuse-passing': 'apology-passage',
  'number-one': 'numbers', 'number-two': 'numbers', 'number-three': 'numbers', 'number-four': 'numbers',
  'table-for': 'table', 'menu': 'table', 'id-like-this': 'table', 'enjoy-meal': 'table',
  'cheers': 'table', 'delicious': 'table', 'check': 'table', 'money-surprise': 'table',
  'where-is': 'out-about', 'ticket': 'out-about', 'bathroom': 'out-about',
  'door-men': 'out-about', 'door-women': 'out-about', 'atm': 'out-about',
  'how-much': 'shopping', 'card': 'shopping', 'cash': 'shopping', 'bag': 'shopping',
  'deep-cut': 'deep-cuts',
}

// \n forces the heading's line break (rendered with white-space: pre-line).
export const CATEGORY_LABEL = {
  'coming-going':    'Coming\n& going',
  'basics':          'The\nbasics',
  'language':        'Language',
  'apology-passage': 'Apologies',
  'numbers':         'Numbers',
  'table':           'At the\ntable',
  'out-about':       'Out and about',
  'shopping':        'Shopping',
  'deep-cuts':       'Deep cuts',
}

// Category display order, derived from WORD_SLOTS (first appearance wins).
const CATEGORY_ORDER = []
for (const slot of WORD_SLOTS) {
  const c = SLOT_CATEGORY[slot]
  if (c && !CATEGORY_ORDER.includes(c)) CATEGORY_ORDER.push(c)
}
const slotIndex = Object.fromEntries(WORD_SLOTS.map((s, i) => [s, i]))

// Group a flat list of word entries into ordered categories, each sorted by the
// canonical slot order (deep cuts by deepCutOrder).
export function groupWords(words) {
  const byCat = {}
  for (const w of words) {
    const cat = SLOT_CATEGORY[w.slot]
    if (!cat) continue
    ;(byCat[cat] ||= []).push(w)
  }
  return CATEGORY_ORDER
    .filter(cat => byCat[cat]?.length)
    .map(cat => ({
      key: cat,
      label: CATEGORY_LABEL[cat],
      words: byCat[cat].sort((a, b) =>
        cat === 'deep-cuts'
          ? (a.deepCutOrder || 0) - (b.deepCutOrder || 0)
          : (slotIndex[a.slot] ?? 999) - (slotIndex[b.slot] ?? 999)
      ),
    }))
}

// Per-section watercolor illustrations, served from public/words/. A category
// with no illustration here just shows its title (the <img> hides on 404).
export const CATEGORY_ILLUSTRATION = {
  table: '/words/at-the-table.png',
}

// The preamble is stored as markdown "- " bullets; render as a plain list.
export function preambleBullets(preamble) {
  if (!preamble) return []
  return preamble.split('\n').map(l => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean)
}

// Deep cuts subtitle is a formula, not stored content.
export const deepCutsSubtitle = cityName => `Words you won't need, but ${cityName} does`
