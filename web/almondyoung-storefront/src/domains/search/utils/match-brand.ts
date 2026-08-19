// 검색어 ↔ 브랜드관 브랜드 대조. 상품 인덱스의 brand 필드는 신뢰할 수 없어
// (실데이터 불일치) 브랜드관 카테고리 이름만 근거로 삼는다.
//
// 브랜드 이름은 "노몬드 No mond" 처럼 한/영 병기가 많다. 이름을 토큰으로 쪼개
// 공백 제거·소문자화한 검색어에 토큰이 포함되면 매칭으로 본다.
// - 한글 토큰은 2자 이상, 라틴 토큰은 3자 이상만 인정 ("No" 같은 짧은 조각 오탐 방지)
// - 여러 브랜드가 걸리면 매칭 토큰이 가장 긴 브랜드 하나만 고른다

export interface BrandMatchCandidate {
  name: string
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "")
}

function brandTokens(name: string): string[] {
  const tokens = new Set<string>()
  const normalizedFull = normalize(name)
  if (normalizedFull.length >= 2) tokens.add(normalizedFull)

  for (const raw of name.split(/[\s/·]+/)) {
    const token = normalize(raw)
    if (!token) continue
    const isLatinOnly = /^[a-z0-9&:'-]+$/.test(token)
    if (isLatinOnly ? token.length >= 3 : token.length >= 2) {
      tokens.add(token)
    }
  }
  return Array.from(tokens)
}

/**
 * 검색어와 매칭되는 브랜드 하나를 고른다(없으면 null).
 * candidates 는 이미 노출 필터(비활성·회원전용)가 끝난 목록이어야 한다.
 */
export function matchBrandForQuery<T extends BrandMatchCandidate>(
  candidates: T[],
  query: string
): T | null {
  const normalizedQuery = normalize(query)
  if (normalizedQuery.length < 2) return null

  let best: { brand: T; tokenLength: number } | null = null
  for (const brand of candidates) {
    for (const token of brandTokens(brand.name)) {
      if (!normalizedQuery.includes(token)) continue
      if (!best || token.length > best.tokenLength) {
        best = { brand, tokenLength: token.length }
      }
    }
  }
  return best?.brand ?? null
}
