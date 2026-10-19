import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { WorksiteDto } from './attendance.dto';

describe('worksite address input', () => {
  const worksite = {
    name: '본사',
    latitude: 37.5,
    longitude: 127,
    radiusMeters: 300,
    accuracyMeters: 100,
  };

  it('retains a searched address when validated with the API whitelist', async () => {
    const input = plainToInstance(WorksiteDto, {
      ...worksite,
      address: '서울특별시 강남구 테헤란로 123',
    });

    expect(await validate(input, { whitelist: true })).toEqual([]);
    expect(input).toHaveProperty('address', '서울특별시 강남구 테헤란로 123');
  });

  it('continues accepting existing coordinate-only clients', async () => {
    const input = plainToInstance(WorksiteDto, worksite);

    expect(await validate(input, { whitelist: true })).toEqual([]);
  });

  it.each([123, '가'.repeat(301)])('rejects an invalid address: %p', async (address) => {
    const input = plainToInstance(WorksiteDto, { ...worksite, address });
    const errors = await validate(input, { whitelist: true });

    expect(errors.some((error) => error.property === 'address')).toBe(true);
  });
});
