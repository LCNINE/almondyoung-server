import sanitize from "sanitize-html"

const MAX_LENGTH = 155
const BLOCK_BOUNDARY = /<\/(p|div|h[1-6]|li|tr|td|section|article)>|<br\s*\/?>/gi
// soft hyphen, zero-width space, word joiner
const INVISIBLE = /[\u00ad\u200b\u2060]/g

function normalize(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim()
}

// 상세 HTML 은 어드민 에디터/cafe24 이관본이라 마크업·공백이 뒤섞여 있다.
export function toMetaDescription(
  html: string | null | undefined
): string | undefined {
  if (!html) return undefined

  const text = normalize(
    sanitize(html.replace(BLOCK_BOUNDARY, " "), {
      allowedTags: [],
      allowedAttributes: {},
    })
  )

  if (!text) return undefined

  return truncate(text)
}

// 어드민 상세설명 에디터가 저장하는 마크다운용. 이미지 지시자(::product-image{...})와
// 마크다운 문법을 걷어내 텍스트만 남긴다. 지시자 이름은 영문자로 시작하므로
// "10:00" 같은 시간 표기는 건드리지 않는다.
export function markdownToMetaDescription(
  markdown: string | null | undefined
): string | undefined {
  if (!markdown) return undefined

  const text = normalize(
    sanitize(
      markdown
        .replace(/:{1,3}[a-zA-Z][\w-]*(\[[^\]]*\])?\s*(\{[^}]*\})?/g, " ")
        .replace(/```[\w-]*\n?/g, " ")
        .replace(/`([^`]*)`/g, "$1")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/^[ \t]*(#{1,6}|>+|[-*+]|\d+\.)[ \t]+/gm, "")
        .replace(/[*_~]{1,3}([^*_~\s][^*_~]*)[*_~]{1,3}/g, "$1")
        .replace(/^\|(.*)\|$/gm, (_, row: string) => row.replace(/\|/g, " "))
        .replace(/^[-=|: ]{3,}$/gm, " "),
      { allowedTags: [], allowedAttributes: {} }
    )
  )

  if (!text) return undefined

  return truncate(text)
}

function truncate(text: string): string {
  return text.length <= MAX_LENGTH
    ? text
    : `${text.slice(0, MAX_LENGTH - 1).trimEnd()}…`
}
