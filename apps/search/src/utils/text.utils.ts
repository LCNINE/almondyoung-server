import { convertQwertyToHangul, disassemble, romanize } from 'es-hangul';

export function compactText(value: string): string {
  return value.replace(/\s+/g, '');
}

// 한글은 같은 글자를 두 가지로 표현할 수 있다 — "값" = U+AC03(NFC) 또는 U+1100 U+1161 U+11AA(NFD).
// macOS 파일시스템·일부 브라우저 입력이 NFD 를 흘리는데, es-hangul 은 NFD 를 음절로 인식하지
// 못해 disassemble('값') 이 분해 없이 "값" 을 그대로 돌려준다. 색인·검색 어느 한쪽만 NFD 여도
// 자모 매칭이 통째로 빗나가므로 모든 진입점에서 NFC 로 맞춘다.
function normalizeHangul(value: string): string {
  return value.normalize('NFC');
}

// "롤러킹" → "ㄹㅗㄹㄹㅓㅋㅣㅇ". 완성형은 토큰이 2~4글자라 fuzziness=1 이 인덱스를
// 통째로 긁는다(실측: 정상 검색어 85.8% 가 5000건으로 폭증). 자모로 펴면 6~12자가 돼 엄격해진다.
// 색인과 검색이 같은 함수를 타야 한다 — 한쪽만 바꾸면 조용히 안 맞는다.
export function toJamo(value: string): string {
  // 자모 필드는 whitespace analyzer 라 대소문자를 구분한다.
  return disassemble(normalizeHangul(value)).toLowerCase();
}

// "vjak" → "퍼마". 완성된 음절만 나올 때만 인정한다 — 진짜 영문은 자모가 섞인다
// ("Perma" → "ㅖㄷ금"). 호출부는 원문 검색을 함께 유지할 것.
export function qwertyToHangul(value: string): string {
  // es-hangul 은 조합 불가능한 자모 시퀀스를 만나면 throw 한다 — "elationpassport" 는
  // ㅜ 다음에 ㅔ 가 와서 "Invalid hangul Characters" 로 터졌고, 그대로 검색 500 이 됐다.
  let converted: string;
  try {
    converted = normalizeHangul(convertQwertyToHangul(value).trim());
  } catch {
    return '';
  }
  // 이미 한글인 검색어는 변환기가 그대로 돌려주므로 아래 가드를 통과한다. 교정이 아니니 버린다.
  if (converted === normalizeHangul(value).trim()) {
    return '';
  }
  return /^[가-힣\s]+$/.test(converted) ? converted : '';
}

// "탯밤" → "taetbam". 고객이 한글 발음을 영어로 옮겨 치는 검색어("tatbam")를 되돌리는 데 쓴다.
// 한글이 없는 말은 되돌릴 것도 없으므로 빈 문자열을 준다.
export function toRoman(value: string): string {
  if (!/[가-힣]/.test(value)) {
    return '';
  }
  try {
    return romanize(normalizeHangul(value)).toLowerCase();
  } catch {
    return '';
  }
}

// 임베딩용 상품명 정제. 용량·모델번호가 섞이면 벡터가 흐려진다 —
// "알콜"↔"에탄올"은 단어끼리 0.429 인데 "소분용 에탄올 80% 60ml" 로는 0.193 이었다.
// 평가셋 17개 기준 1위 적중 5개 → 8개.
const SPEC_UNIT = '(?:ml|l|g|kg|mm|cm|p|ea|pcs|매|장|쌍|구|종|입|개입|개|팩|세트|호)';
const SPEC_PATTERNS: RegExp[] = [
  /\[[^\]]*\]/g, // [캔바]
  /\([^)]*\)/g, // (3쌍)
  /#\s*\w+/g, // #FG144 — 모델번호 규칙보다 먼저 지워야 '#' 이 안 남는다
  /\d+(?:\.\d+)?\s*%/g,
  // 한글 단위(구/매/쌍)는 \b 가 안 먹는다. 30구 의 '구' 가 남았던 자리다.
  new RegExp(`\\d+(?:\\.\\d+)?\\s*${SPEC_UNIT}`, 'gi'),
  /\b[A-Z]{1,5}[-–]?\d{2,}[A-Z]?\b/gi, // KS544K, SC-101
  /\b\d+\b/g,
];

export function stripProductSpec(name: string): string {
  const stripped = SPEC_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, ' '), name)
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-/&#]+|[\s\-/&#]+$/g, '');
  return stripped || name;
}

// 브랜드 제거. 한글은 단어 경계가 없어 "요거트젤"에서 "요거트"만 떼면 "젤"이 남는다.
// 그래서 공백으로 둘러싸인 조각만 지운다.
export function stripBrand(name: string, brand: string | null | undefined): string {
  if (!brand || brand === 'B0000000') {
    return name;
  }

  const candidates = [brand, ...brand.split(/\s+/).filter((token) => token.length >= 2)].sort(
    (a, b) => b.length - a.length,
  );
  const stripped = candidates
    .reduce((acc, token) => acc.replace(new RegExp(`(?<=\\s)${escapeRegExp(token)}(?=\\s)`, 'gi'), ' '), ` ${name} `)
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || name;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 색인과 검색이 같은 함수를 타야 한다.
export function toEmbeddingText(name: string, brand: string | null | undefined): string {
  return stripProductSpec(stripBrand(name, brand));
}
