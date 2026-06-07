import type { CreateMasterDto, CreateMasterResponseDto } from './products';

type Assert<T extends true> = T;
type HasNoLegacyCreateFields = Extract<keyof CreateMasterDto, 'name' | 'basePrice' | 'pricingStrategy'> extends never
  ? true
  : false;

type CreateMasterKeepsLegacyFieldsOut = Assert<HasNoLegacyCreateFields>;

describe('product master create contract', () => {
  it('allows an empty create request and exposes redirect ids from the response', () => {
    const request: CreateMasterDto = {};
    const response: Pick<CreateMasterResponseDto, 'id' | 'masterId'> = {
      id: 'version-1',
      masterId: 'master-1',
    };

    expect(request).toEqual({});
    expect(response).toEqual({ id: 'version-1', masterId: 'master-1' });
  });
});
