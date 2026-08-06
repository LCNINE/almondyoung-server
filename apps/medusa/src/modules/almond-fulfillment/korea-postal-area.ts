/**
 * 우편번호 → 제주 / 도서산간 판정.
 *
 * 목록은 몰 전체 공통이라 상수로 둔다. 그룹별로는 금액만 받는다.
 * ponytail: 코드 상수. 택배사마다 도서산간 범위가 달라 협상이 생기면 store setting 으로 승격한다.
 *
 * 기준: 5자리 신 우편번호. 구 6자리나 형식이 깨진 값은 판정하지 않는다(추가비 0).
 */

export type KoreanShippingArea = 'jeju' | 'island';

type PostalRange = { from: number; to: number; label: string };

const JEJU: PostalRange[] = [{ from: 63000, to: 63644, label: '제주특별자치도' }];

const ISLAND: PostalRange[] = [
  { from: 40200, to: 40240, label: '경북 울릉군' },
  { from: 23004, to: 23004, label: '인천 강화군 교동면' },
  { from: 23100, to: 23116, label: '인천 강화군 도서' },
  { from: 23124, to: 23136, label: '인천 옹진군' },
  { from: 32133, to: 32133, label: '충남 태안군 도서' },
  { from: 33411, to: 33411, label: '충남 보령시 도서' },
  { from: 53031, to: 53033, label: '경남 통영시 도서' },
  { from: 54000, to: 54000, label: '전북 군산시 도서' },
  { from: 56347, to: 56349, label: '전북 부안군 위도면' },
  { from: 58760, to: 58762, label: '전남 영광군 낙월면' },
  { from: 58800, to: 58880, label: '전남 신안군' },
  { from: 58900, to: 58958, label: '전남 진도군' },
  { from: 59100, to: 59166, label: '전남 완도군' },
  { from: 59650, to: 59653, label: '전남 고흥군 도서' },
  { from: 59766, to: 59781, label: '전남 여수시 도서' },
];

function toPostalNumber(postalCode?: string | null): number | null {
  if (!postalCode) return null;
  const digits = postalCode.replace(/\D/g, '');
  if (digits.length !== 5) return null;
  return Number(digits);
}

function inRanges(value: number, ranges: PostalRange[]): boolean {
  return ranges.some((range) => value >= range.from && value <= range.to);
}

export function resolveKoreanShippingArea(postalCode?: string | null): KoreanShippingArea | null {
  const value = toPostalNumber(postalCode);
  if (value === null) return null;

  if (inRanges(value, JEJU)) return 'jeju';
  if (inRanges(value, ISLAND)) return 'island';
  return null;
}
