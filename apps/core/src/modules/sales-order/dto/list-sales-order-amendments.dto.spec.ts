import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ListSalesOrderAmendmentsQueryDto } from './list-sales-order-amendments.dto';

function cursorErrors(cursor: string) {
  return validateSync(plainToInstance(ListSalesOrderAmendmentsQueryDto, { cursor })).filter(
    (error) => error.property === 'cursor',
  );
}

describe('ListSalesOrderAmendmentsQueryDto.cursor', () => {
  it('nextCursor 모양(ISO 시각|UUID)은 받는다', () => {
    expect(cursorErrors('2026-10-05T00:00:00.000Z|0b5c8f8e-3c1a-4d7e-9f00-1234567890ab')).toEqual([]);
  });

  it.each([
    ['UUID 자리에 하이픈 36개', `2026-10-05T00:00:00.000Z|${'-'.repeat(36)}`],
    ['하이픈 위치가 틀린 36자', '2026-10-05T00:00:00.000Z|0b5c8f8e3-c1a-4d7e-9f00-1234567890ab'],
    ['구분자 없음', '0b5c8f8e-3c1a-4d7e-9f00-1234567890ab'],
  ])('%s 는 거절한다', (_label, cursor) => {
    expect(cursorErrors(cursor)).toHaveLength(1);
  });
});
