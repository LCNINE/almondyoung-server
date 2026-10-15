import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { DiscardFailureDto, actorIdOf } from './event-failures.http';

describe('이벤트 실패 HTTP 공용부 (#1016 7·8번)', () => {
  it('종결 사유는 비면 안 되고 500자까지', async () => {
    expect(await validate(plainToInstance(DiscardFailureDto, { reason: '' }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(DiscardFailureDto, { reason: 'x'.repeat(501) }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(DiscardFailureDto, { reason: '수기 처리함' }))).toHaveLength(0);
  });

  it('actor 는 id → userId → sub 순으로 읽고, 없으면 null', () => {
    expect(actorIdOf({ id: 'a', userId: 'b' })).toBe('a');
    expect(actorIdOf({ userId: 'b', sub: 'c' })).toBe('b');
    expect(actorIdOf({ sub: 'c' })).toBe('c');
    expect(actorIdOf(undefined)).toBeNull();
  });
});
