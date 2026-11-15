// Splits text into sentences. Shared by the thread page (one span per
// sentence, so the one being read aloud can be highlighted) and
// scripts/thread-audio.mjs (which times each sentence in the narration), so
// both must split identically.
export function sentences(text) {
  return (text || '').split(/(?<=[.!?”’)])\s+(?=[A-Z0-9“‘"'(À-Ž])/).filter(Boolean)
}

// What the narrator says for a piece of text: year ranges are read as
// "1873 to 1876" rather than as two numbers.
export function speakable(text) {
  return (text || '')
    .replace(/(\d)\s*–\s*(\d)/g, '$1 to $2')
    .replace(/–/g, ', ')
    .replace(/\bc\. (\d)/g, 'around $1')
}

// The narration for a thread, as segments (the intro, then one per chapter).
// Each segment is a list of parts; each part has the key of the element it
// highlights and the words to say. A chapter's optional `mediaNote` is spoken
// last and never shown: it says what the stories listed under the chapter
// are, while the page scrolls down to them.
export function threadScript(thread) {
  const intro = thread.intro.join(' ')
  const segs = [[
    { key: 'title', say: `${thread.title}.` },
    ...sentences(intro).map((s, j) => ({ key: `i-${j}`, say: s })),
  ]]
  thread.chapters.forEach((c, i) => {
    segs.push([
      { key: `c${i}-h`, say: `${c.heading}. ${c.place}.` },
      ...sentences(c.text).map((s, j) => ({ key: `c${i}-${j}`, say: s })),
      ...(c.mediaNote && c.stories?.length ? [{ key: `c${i}-m`, say: c.mediaNote }] : []),
    ])
  })
  return segs.map(parts => parts.map(p => ({ ...p, say: speakable(p.say) })))
}
