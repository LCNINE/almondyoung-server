import { allocateLines } from './allocate-lines';
import { SourceCapacity } from './allocation.types';

const cap = (
  skuId: string,
  sourceLocationId: string,
  locationCode: string,
  remainingQty: number,
  stockVersion = 1,
): SourceCapacity => ({ skuId, sourceLocationId, locationCode, remainingQty, stockVersion });

const line = (id: string, skuId: string, qty: number, workItemId = `wi-${id}`) => ({ id, skuId, qty, workItemId });

describe('allocateLines — E8 배정 규칙', () => {
  it('한 로케이션에서 줄 전량을 채울 수 있으면 그곳에서만 — 앞 코드의 1개짜리로 쪼개지 않는다', () => {
    const { drafts, shortages } = allocateLines([line('l1', 'sku', 2)], [cap('sku', 'loc-a', 'A-01', 1), cap('sku', 'loc-b', 'B-01', 5)]);
    expect(shortages).toEqual([]);
    expect(drafts).toEqual([
      { workItemId: 'wi-l1', shipmentLineId: 'l1', sourceLocationId: 'loc-b', qty: 2, sourceStockVersion: 1 },
    ]);
  });

  it('전량 가능한 곳이 여럿이면 로케이션 코드 순 첫째(id 순이 아니다)', () => {
    const { drafts } = allocateLines([line('l1', 'sku', 2)], [cap('sku', 'id-1', 'C-01', 9), cap('sku', 'id-9', 'B-01', 9)]);
    expect(drafts.map((d) => d.sourceLocationId)).toEqual(['id-9']);
  });

  it('어디서도 전량이 안 되면 코드 순으로 나눠 채운다', () => {
    const { drafts, shortages } = allocateLines(
      [line('l1', 'sku', 4)],
      [cap('sku', 'loc-c', 'C-01', 3), cap('sku', 'loc-a', 'A-01', 2)],
    );
    expect(shortages).toEqual([]);
    expect(drafts.map((d) => [d.sourceLocationId, d.qty])).toEqual([
      ['loc-a', 2],
      ['loc-c', 2],
    ]);
  });

  it('줄은 줄 id 순으로 처리하고 앞 줄이 쓴 용량은 뒤 줄이 못 쓴다', () => {
    const { drafts } = allocateLines(
      [line('l2', 'sku', 3), line('l1', 'sku', 2)],
      [cap('sku', 'loc-a', 'A-01', 2), cap('sku', 'loc-b', 'B-01', 3)],
    );
    expect(drafts.map((d) => [d.shipmentLineId, d.sourceLocationId, d.qty])).toEqual([
      ['l1', 'loc-a', 2],
      ['l2', 'loc-b', 3],
    ]);
  });

  it('입력 순서를 섞어도 결과가 같다(결정적)', () => {
    const lines = [line('l1', 'sku', 2), line('l2', 'sku', 2)];
    const caps = [cap('sku', 'loc-a', 'A-01', 3), cap('sku', 'loc-b', 'B-01', 3)];
    expect(allocateLines([...lines].reverse(), [...caps].reverse())).toEqual(allocateLines(lines, caps));
  });

  it('다른 SKU 의 용량은 쓰지 않는다', () => {
    const { drafts, shortages } = allocateLines([line('l1', 'sku-1', 1)], [cap('sku-2', 'loc-a', 'A-01', 5)]);
    expect(drafts).toEqual([]);
    expect(shortages).toEqual([
      { workItemId: 'wi-l1', shipmentLineId: 'l1', skuId: 'sku-1', requiredQty: 1, shortQty: 1, reason: 'STOCK_SHORT' },
    ]);
  });

  it('입력 용량 배열을 변경하지 않는다', () => {
    const capacities = [cap('sku', 'loc-a', 'A-01', 5)];
    allocateLines([line('l1', 'sku', 2)], capacities);
    expect(capacities[0].remainingQty).toBe(5);
  });
});

describe('allocateLines — 모자란 줄 보고', () => {
  it('첫 부족에서 멈추지 않고 모자란 줄을 전부 돌려준다', () => {
    const { shortages } = allocateLines(
      [line('l1', 'sku-1', 3), line('l2', 'sku-2', 1), line('l3', 'sku-1', 2)],
      [cap('sku-1', 'loc-a', 'A-01', 2)],
    );
    expect(shortages.map((s) => [s.shipmentLineId, s.shortQty])).toEqual([
      ['l1', 1],
      ['l2', 1],
      ['l3', 2],
    ]);
  });

  it('적치 대기분까지 더하면 채워지면 INBOUND_PENDING, 아니면 STOCK_SHORT', () => {
    const { shortages } = allocateLines(
      [line('l1', 'sku-1', 3), line('l2', 'sku-2', 3)],
      [cap('sku-1', 'loc-a', 'A-01', 1), cap('sku-2', 'loc-a', 'A-01', 1)],
      new Map([
        ['sku-1', 2],
        ['sku-2', 1],
      ]),
    );
    expect(shortages.map((s) => [s.shipmentLineId, s.reason])).toEqual([
      ['l1', 'INBOUND_PENDING'],
      ['l2', 'STOCK_SHORT'],
    ]);
  });

  it('적치 대기분은 줄 사이에 누적 소진된다 — 둘째 줄은 남은 대기분으로 판정', () => {
    const { shortages } = allocateLines(
      [line('l1', 'sku', 2), line('l2', 'sku', 2)],
      [],
      new Map([['sku', 3]]),
    );
    expect(shortages.map((s) => s.reason)).toEqual(['INBOUND_PENDING', 'STOCK_SHORT']);
  });
});
