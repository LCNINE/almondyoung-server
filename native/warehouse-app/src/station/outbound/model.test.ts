import { describe, expect, it } from 'vitest';
import type { ShipmentByWaybill } from '../../domains/outbound/types';
import { workFor, type BoxWorkHandle } from './model';

const box = (shipmentId: string) => ({ shipmentId }) as ShipmentByWaybill;
const handle = (shipmentId: string, seq: number): BoxWorkHandle => ({
  shipmentId,
  seq,
  accept: () => {},
  disarm: () => {},
  settle: async () => {},
});

describe('workFor — 정한 화면의 손잡이만 상품을 받는다', () => {
  it('정한 박스 화면과 같은 박스·같은 번호의 손잡이면 돌려준다', () => {
    const own = handle('s-2', 4);
    expect(workFor({ kind: 'inspect', box: box('s-2'), seq: 4 }, own)).toBe(own);
    expect(workFor({ kind: 'withdraw', box: box('s-2'), seq: 4 }, own)).toBe(own);
  });

  it('옛 박스의 손잡이가 다시 걸려 있으면 돌려주지 않는다 — 다른 박스', () => {
    expect(workFor({ kind: 'inspect', box: box('s-2'), seq: 4 }, handle('s-1', 3))).toBeNull();
  });

  it('같은 박스라도 다시 연 화면(번호가 다름)이거나 검수에서 뺄 상품으로 넘어갔으면 돌려주지 않는다', () => {
    expect(workFor({ kind: 'inspect', box: box('s-1'), seq: 4 }, handle('s-1', 3))).toBeNull();
    expect(workFor({ kind: 'withdraw', box: box('s-1'), seq: 5 }, handle('s-1', 4))).toBeNull();
  });

  it('박스 화면이 아니거나 손잡이가 없으면 null', () => {
    expect(workFor({ kind: 'waiting' }, handle('s-1', 1))).toBeNull();
    expect(workFor({ kind: 'withdrawn', box: box('s-1') }, handle('s-1', 1))).toBeNull();
    expect(workFor({ kind: 'inspect', box: box('s-1'), seq: 1 }, null)).toBeNull();
  });
});
