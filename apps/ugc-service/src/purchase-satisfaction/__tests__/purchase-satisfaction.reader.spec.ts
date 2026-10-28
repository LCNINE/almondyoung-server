import { BadRequestError } from '@app/shared';
import { toKstRange } from '../purchase-satisfaction.reader';

describe('toKstRange', () => {
  it('KST 하루를 UTC 구간으로 바꾸고 to 는 포함이다', () => {
    const { gte, lt } = toKstRange('2026-10-28', '2026-10-28');
    expect(gte?.toISOString()).toBe('2026-10-27T15:00:00.000Z');
    expect(lt?.toISOString()).toBe('2026-10-28T15:00:00.000Z');
  });

  it('한쪽만 주면 그쪽만 채운다', () => {
    expect(toKstRange('2026-10-28')).toEqual({ gte: new Date('2026-10-27T15:00:00.000Z'), lt: undefined });
    expect(toKstRange(undefined, '2026-12-31')).toEqual({ gte: undefined, lt: new Date('2026-12-31T15:00:00.000Z') });
  });

  it('아무것도 없으면 빈 구간이다', () => {
    expect(toKstRange()).toEqual({ gte: undefined, lt: undefined });
  });

  it('존재하지 않는 날짜는 400 이다', () => {
    expect(() => toKstRange('2026-02-30')).toThrow(BadRequestError);
  });
});
