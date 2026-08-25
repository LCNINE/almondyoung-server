import { convertQwertyToHangul, disassemble } from 'es-hangul';

export function compactText(value: string): string {
  return value.replace(/\s+/g, '');
}

// "롤러킹" → "ㄹㅗㄹㄹㅓㅋㅣㅇ". 완성형은 토큰이 2~4글자라 fuzziness=1 이 인덱스를
// 통째로 긁는다(실측: 정상 검색어 85.8% 가 5000건으로 폭증). 자모로 펴면 6~12자가 돼 엄격해진다.
// 색인과 검색이 같은 함수를 타야 한다 — 한쪽만 바꾸면 조용히 안 맞는다.
export function toJamo(value: string): string {
  // 자모 필드는 whitespace analyzer 라 대소문자를 구분한다.
  return disassemble(value).toLowerCase();
}

// "vjak" → "퍼마". 완성된 음절만 나올 때만 인정한다 — 진짜 영문은 자모가 섞인다
// ("Perma" → "ㅖㄷ금"). 호출부는 원문 검색을 함께 유지할 것.
export function qwertyToHangul(value: string): string {
  const converted = convertQwertyToHangul(value).trim();
  return /^[가-힣\s]+$/.test(converted) ? converted : '';
}
