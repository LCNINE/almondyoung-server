import { BadRequestError } from '@app/shared';
import { decodeCursor, encodeCursor } from './order-progress.cursor';

describe('order-progress cursor', () => {
  const id = '0b5c8f8e-3c1a-4d7e-9f00-1234567890ab';

  it('왕복한다', () => {
    const at = new Date('2026-10-06T01:02:03.456Z');
    expect(decodeCursor(encodeCursor(at, id))).toEqual({ at, id });
  });

  it.each([
    ['구분자 없음', id],
    ['시각이 아님', `nope|${id}`],
    ['uuid 아님', '2026-10-06T00:00:00.000Z|x'],
  ])('%s 는 BadRequestError', (_label, cursor) => {
    expect(() => decodeCursor(cursor)).toThrow(BadRequestError);
  });
});
