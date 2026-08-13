import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BulkUpdateDto, BulkDeleteDto, BulkRestoreDto, BulkPolicyDto, MAX_BULK_PRODUCTS } from './bulk-operations.dto';

const ID = '00000000-0000-4000-8000-000000000000';

describe.each([
  ['BulkUpdateDto', BulkUpdateDto],
  ['BulkDeleteDto', BulkDeleteDto],
  ['BulkRestoreDto', BulkRestoreDto],
  ['BulkPolicyDto', BulkPolicyDto],
])('%s productIds 상한', (_name, Dto) => {
  const validate = (productIds: string[]) =>
    validateSync(plainToInstance(Dto as never, { productIds }));

  it('빈 배열을 거부한다', () => {
    expect(validate([])).not.toHaveLength(0);
  });

  it('상한(5000)까지는 통과한다', () => {
    expect(validate(Array.from({ length: MAX_BULK_PRODUCTS }, () => ID))).toHaveLength(0);
  });

  it('상한을 넘으면 거부한다', () => {
    expect(validate(Array.from({ length: MAX_BULK_PRODUCTS + 1 }, () => ID))).not.toHaveLength(0);
  });
});

it('MAX_BULK_PRODUCTS 는 양식 다운로드 상한과 같다', () => {
  expect(MAX_BULK_PRODUCTS).toBe(5000);
});
