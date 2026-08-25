import { convertQwertyToHangul, disassemble } from 'es-hangul';

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
  const converted = normalizeHangul(convertQwertyToHangul(value).trim());
  return /^[가-힣\s]+$/.test(converted) ? converted : '';
}
