const MIN_TAGS = 3

/** 문단 전체가 해시태그로만 이뤄졌으면 태그 배열, 아니면 null */
export function parseHashtagParagraph(text: string): string[] | null {
  const tokens = text.trim().split(/\s+/)

  if (tokens.length < MIN_TAGS) return null
  if (!tokens.every((t) => /^#[^\s#]+$/.test(t))) return null

  return tokens
}
