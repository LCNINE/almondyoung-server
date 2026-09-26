/**
 * 한진 운송장 개인정보 마스킹 (정본 `docs/hanjin-api-integration-reference.md` §3.3).
 *
 * 어느 면·어느 인물에 어느 함수를 적용하는지는 템플릿이 정한다 — 여기는 «어떻게 가리나» 만 안다.
 */

const MASK = '*';
const HANGUL_SYLLABLE = /[가-힣]/;

/**
 * 성명 — 자리는 공백을 빼고 센다(공백은 그대로 둔다).
 * 2·3글자: 2번째 / 4글자: 2·4번째 / 5글자 이상: 국문은 2번째와 4번째 이후, 국문 외는 5번째 이후.
 *
 * 한글 음절이 하나라도 있으면 국문 규칙을 쓴다 — 5글자 이상에서 국문 규칙이 더 많이 가리므로
 * 섞인 이름을 애매하게 판정해도 덜 가리는 쪽으로 새지 않는다.
 */
export function maskName(name: string): string {
  const trimmed = name.trim();
  const letters = trimmed.replace(/\s/g, '').length;
  const korean = HANGUL_SYLLABLE.test(trimmed);
  const masked = (pos: number): boolean => {
    if (letters <= 1) return false;
    if (letters <= 3) return pos === 2;
    if (letters === 4) return pos === 2 || pos === 4;
    return korean ? pos === 2 || pos >= 4 : pos >= 5;
  };

  let pos = 0;
  return Array.from(trimmed)
    .map((ch) => {
      if (/\s/.test(ch)) return ch;
      pos += 1;
      return masked(pos) ? MASK : ch;
    })
    .join('');
}

/** 연락처 — 숫자 기준 마지막 4자리를 가린다. 구분자는 세지 않고 그대로 둔다. 안심번호는 쓰지 않는다. */
export function maskPhone(phone: string): string {
  let remaining = 4;
  return Array.from(phone.trim())
    .reverse()
    .map((ch) => {
      if (remaining === 0 || !/\d/.test(ch)) return ch;
      remaining -= 1;
      return MASK;
    })
    .reverse()
    .join('');
}

// 「…로/…길 + 건물번호(부번)」 가운데 처음으로 마디가 끝나는 곳. `신흥로511번길 80` 의 511 은 뒤에
// `번` 이 붙어 마디가 안 끝나므로 건너뛰고 `511번길 80` 에서 멈춘다.
const ROAD_THROUGH_BUILDING_NO = /^(.*?\S(?:로|길)\s*\d+(?:-\d+)?)(?=[\s,(]|$)/u;
const JIBUN_THROUGH_DONG = /^(.*?\S(?:동|읍|면))(?=\s|$)/u;

/**
 * 주소 — 「읍면동 / 건물번호 이후」를 가린다. 상세주소는 인자로 받지 않는다: 받지 않으면 샐 수도 없다.
 * 기본주소에도 건물번호 뒤에 참고항목이나 잘못 들어온 상세주소가 붙어 있을 수 있어 거기서 자른다.
 * 어느 쪽도 못 찾으면 앞 두 마디(시·도 + 시·군·구)만 남긴다 — 덜 보여주는 쪽으로 실패한다.
 */
export function maskAddress(baseAddress: string): string {
  const trimmed = baseAddress.trim();
  const kept =
    ROAD_THROUGH_BUILDING_NO.exec(trimmed)?.[1] ??
    JIBUN_THROUGH_DONG.exec(trimmed)?.[1] ??
    trimmed.split(/\s+/).slice(0, 2).join(' ');
  return `${kept} ${MASK.repeat(4)}`;
}
