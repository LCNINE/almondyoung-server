import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ListOrderProgressQueryDto } from './list-order-progress.dto';

const errorsOf = (q: Record<string, unknown>) =>
  validateSync(plainToInstance(ListOrderProgressQueryDto, q)).map((e) => e.property);

describe('ListOrderProgressQueryDto', () => {
  it('stage 는 필수이고 알려진 값만', () => {
    expect(errorsOf({})).toContain('stage');
    expect(errorsOf({ stage: 'nope' })).toContain('stage');
    expect(errorsOf({ stage: 'fo' })).toEqual([]);
  });

  it('stuck 은 문자열 true/false 를 불리언으로', () => {
    const dto = plainToInstance(ListOrderProgressQueryDto, { stage: 'fo', stuck: 'true' });
    expect(dto.stuck).toBe(true);
    expect(plainToInstance(ListOrderProgressQueryDto, { stage: 'fo', stuck: 'false' }).stuck).toBe(false);
  });

  it('sort 는 dwell|ordered, limit 은 1~200', () => {
    expect(errorsOf({ stage: 'fo', sort: 'x' })).toContain('sort');
    expect(errorsOf({ stage: 'fo', limit: '201' })).toContain('limit');
  });
});
