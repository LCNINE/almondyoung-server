import { parseCliArgs } from './build-location-master';

describe('parseCliArgs', () => {
  it('기본은 dry-run 이다', () => {
    expect(parseCliArgs([], {})).toEqual({ apply: false, warehouseId: undefined });
  });

  it('--apply 와 --warehouse-id 를 읽는다', () => {
    expect(parseCliArgs(['--apply', '--warehouse-id', 'w-1'], {})).toEqual({ apply: true, warehouseId: 'w-1' });
  });

  it('DRY_RUN 이 켜져 있으면 dry-run 이고, --apply 와 함께면 거절한다 (run.sh 가 [DRY_RUN] 을 찍기 때문)', () => {
    expect(parseCliArgs([], { DRY_RUN: '1' })).toEqual({ apply: false, warehouseId: undefined });
    expect(() => parseCliArgs(['--apply'], { DRY_RUN: '1' })).toThrow(/DRY_RUN/);
  });

  it('--warehouse-id 에 값이 없으면 자동 선택으로 넘어가지 않고 거절한다', () => {
    expect(() => parseCliArgs(['--warehouse-id'], {})).toThrow(/--warehouse-id/);
    expect(() => parseCliArgs(['--warehouse-id', '--apply'], {})).toThrow(/--warehouse-id/);
  });
});
