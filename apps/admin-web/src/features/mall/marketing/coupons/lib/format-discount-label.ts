/**
 * 쿠폰 목록·상세의 「할인」 칸 문구를 조립한다 (#488 A4).
 *
 * 목록과 상세가 각자 `.tsx` 안에서 같은 문자열을 만들고 있었고, `.tsx` 는 admin-web 의 jest
 * transform(`^.+\.(t|j)s$`) 밖이라 **테스트가 실행조차 되지 않았다.** 그래서 `.ts` 로 뽑는다.
 */

export interface DiscountApplicationMethodLike {
  type: string;
  value: number;
}

export function formatDiscountLabel(
  applicationMethod: DiscountApplicationMethodLike | null | undefined,
  maxDiscountAmount: number | null | undefined,
): string {
  if (!applicationMethod) return '-';

  if (applicationMethod.type !== 'percentage') {
    return `${applicationMethod.value.toLocaleString('ko-KR')}원`;
  }

  const base = `${applicationMethod.value}%`;
  // `0` 도 상한이다 — falsy 판정으로 흘리면 「상한 0원」이 「상한 없음」으로 보인다.
  if (maxDiscountAmount == null || !Number.isFinite(maxDiscountAmount)) return base;
  return `${base} (최대 ${maxDiscountAmount.toLocaleString('ko-KR')}원)`;
}
