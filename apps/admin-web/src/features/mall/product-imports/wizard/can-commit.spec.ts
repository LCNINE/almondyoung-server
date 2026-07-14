import { canCommit } from './can-commit';
import type { ValidatePreviewDto } from '@/lib/types/dto/product-import';

const preview = (over: Partial<ValidatePreviewDto> = {}): ValidatePreviewDto => ({
  totalRows: 3,
  validCount: 3,
  invalidCount: 0,
  rows: [],
  ...over,
});

describe('canCommit', () => {
  it('invalid 0 이고 총 행 > 0 이면 true', () => {
    expect(canCommit(preview())).toBe(true);
  });
  it('invalid 가 하나라도 있으면 false', () => {
    expect(canCommit(preview({ invalidCount: 1, validCount: 2 }))).toBe(false);
  });
  it('총 행이 0 이면 false', () => {
    expect(canCommit(preview({ totalRows: 0, validCount: 0 }))).toBe(false);
  });
  it('preview 가 없으면 false', () => {
    expect(canCommit(null)).toBe(false);
    expect(canCommit(undefined)).toBe(false);
  });
});
