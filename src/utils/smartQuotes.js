// Straight quotes and apostrophes → typographic ones, so copy reads right even
// when something new is pasted into Contentful with ' and ".
//
//   "word" → “word”     it's → it’s     'word' → ‘word’     '68 → ’68
//
// A single quote after a space normally opens a quotation; before a digit or a
// known elision ('til, 'em, 'n', Neapolitan 'e / 'na, Dutch 't) it's an
// apostrophe.
const OPENS_AFTER = /[\s(\[—–\-\/“‘]/
const ELISION = /^(\d|(til|em|cause|tis|twas|n|e|na|nu|t)\b|(Tis|Twas)\b)/

export function smartQuotes(s) {
  if (typeof s !== 'string' || !/['"]/.test(s)) return s
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    const prev = i === 0 ? ' ' : s[i - 1]
    if (c === '"') out += OPENS_AFTER.test(prev) ? '“' : '”'
    else if (c === "'") out += OPENS_AFTER.test(prev) && !ELISION.test(s.slice(i + 1)) ? '‘' : '’'
    else out += c
  }
  return out
}

// Strings that must stay byte-for-byte: links, file paths, IDs.
const LITERAL = /^(https?:|\/\/|\/|www\.|mailto:)/
const LITERAL_KEY = /url|link|href|slug|^id$|file|image|spotify|apple|youtube|imdb|isbn/i

// Applies smartQuotes to every text value in a Contentful response (fields of
// the items and of linked entries), in place.
export function smartenEntries(res) {
  const seen = new WeakSet()
  const walk = (o, key) => {
    if (!o || typeof o !== 'object' || seen.has(o)) return
    seen.add(o)
    for (const k of Object.keys(o)) {
      if (k === 'sys' || k === 'metadata') continue
      const v = o[k]
      if (typeof v === 'string') {
        if (!LITERAL.test(v) && !LITERAL_KEY.test(k) && !LITERAL_KEY.test(key || '')) o[k] = smartQuotes(v)
      } else walk(v, k)
    }
  }
  walk(res.items)
  if (res.includes) walk(res.includes)
  return res
}
