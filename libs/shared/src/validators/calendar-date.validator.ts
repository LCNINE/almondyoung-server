import { ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

/**
 * 달력에 실제로 존재하는 `YYYY-MM-DD` 인지 검증한다.
 *
 * 이 파일이 존재하는 이유는 두 데코레이터가 **둘 다 부족했기** 때문이다.
 * - `@IsDateString()` 은 부분 ISO('2026', '2026-08')와 오프셋 붙은 타임스탬프를 통과시킨다.
 *   그 값이 `date` 컬럼에 닿으면 `invalid input syntax for type date` 로 트랜잭션이 죽는다.
 * - 모양만 보는 `@Matches(/^\d{4}-\d{2}-\d{2}$/)` 는 '2026-13-45' 를 통과시킨다.
 *   이번엔 `date/time field value out of range` 다. 둘 다 도메인 예외가 아니라
 *   드라이버 에러라 400 이 아니라 **500** 으로 나간다.
 * - 둘을 겹쳐도 '2026-02-31' 과 윤년이 아닌 해의 '2026-02-29' 는 여전히 통과한다.
 *
 * 그래서 **왕복 비교** 한 줄로 모양·범위·달력(윤년 포함)을 동시에 본다: JS 가 넘겨버린
 * 날짜는 원문과 달라진다(`new Date('2026-02-31T00:00:00.000Z')` → `2026-03-03`).
 * 되돌려 찍은 문자열이 원문과 같아야만 실재하는 날짜다.
 */
const CALENDAR_DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDate(value: string): boolean {
  if (!CALENDAR_DATE_SHAPE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * `@Validate(IsCalendarDateConstraint)` 로 붙인다 (wallet 의 payerNumber 검증과 같은 형태).
 *
 * 원래 core 발주 DTO 전용이었으나, `new Date(...).toISOString()` 으로 흘러가는 날짜 쿼리
 * 파라미터(search 키워드 통계 등)도 같은 500 경로를 가져 @app/shared 로 올렸다.
 */
@ValidatorConstraint({ name: 'isCalendarDate', async: false })
export class IsCalendarDateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && isCalendarDate(value);
  }

  defaultMessage(): string {
    return '달력에 존재하는 날짜를 YYYY-MM-DD 형식으로 보내세요 (예: 2026-08-26). 시각·시간대는 받지 않습니다.';
  }
}
