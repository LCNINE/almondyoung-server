import sanitize from "sanitize-html"

// 레거시 상세 HTML(cafe24 이관본)의 <img> 는 alt 가 없다. 서버에서만 부를 것 —
// sanitize-html 을 클라이언트 번들에 넣지 않기 위해서다.
export function withImageAlt(
  html: string,
  buildAlt: (index: number) => string
): string {
  let index = 0

  return sanitize(html, {
    // 필터링이 목적이 아니라 alt 만 채우는 통과 변환이다. 호출부가 이미
    // dangerouslySetInnerHTML 로 원문을 그대로 넣고 있어 검열 범위를 바꾸지 않는다.
    allowedTags: false,
    allowedAttributes: false,
    allowVulnerableTags: true,
    transformTags: {
      img: (tagName, attribs) => {
        index += 1
        if (attribs.alt?.trim()) return { tagName, attribs }
        return { tagName, attribs: { ...attribs, alt: buildAlt(index) } }
      },
    },
  })
}
