import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SupplierFiltersDto } from './supplier-filters.dto';

describe('SupplierFiltersDto.isDirectDelivery', () => {
  const parse = (plain: Record<string, unknown>) => plainToInstance(SupplierFiltersDto, plain);

  it("문자열 'true'/'false' 가 boolean 이 된다", async () => {
    const t = parse({ isDirectDelivery: 'true' });
    const f = parse({ isDirectDelivery: 'false' });
    expect(t.isDirectDelivery).toBe(true);
    expect(f.isDirectDelivery).toBe(false);
    expect(await validate(t)).toHaveLength(0);
    expect(await validate(f)).toHaveLength(0);
  });

  it('생략하면 undefined 로 통과한다', async () => {
    const dto = parse({});
    expect(dto.isDirectDelivery).toBeUndefined();
    expect(await validate(dto)).toHaveLength(0);
  });

  it('엉뚱한 문자열은 검증에서 거절된다', async () => {
    expect(await validate(parse({ isDirectDelivery: 'maybe' }))).not.toHaveLength(0);
  });
});
