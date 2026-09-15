import { RESTOCK_SQL } from './sync-restock-to-medusa';

// 기한 지난 발주 라인이 MIN 후보로 돌아오면 과거 날짜가 variant.metadata 에 박히고,
// storefront `pickEarliestRestock` 이 그걸 stale 로 버려 **진짜 입고예정이 있는 상품이
// 그냥 품절로 보인다**. 2026-09-15 live 에서 variant 137개가 이 상태였다.
describe('RESTOCK_SQL', () => {
  it('기한 지난 발주 라인을 후보에서 뺀다', () => {
    expect(RESTOCK_SQL).toContain('pol.expected_arrival >= CURRENT_DATE');
  });

  it('날짜 유무만 보는 옛 조건으로 되돌아가지 않는다', () => {
    expect(RESTOCK_SQL).not.toMatch(/expected_arrival\s+IS\s+NOT\s+NULL/i);
  });

  it('미수령 잔량이 남은 라인만 센다', () => {
    expect(RESTOCK_SQL).toContain('pol.received_qty < COALESCE(pol.ordered_qty, 0)');
    expect(RESTOCK_SQL).toContain('pol.closed_at IS NULL');
  });
});
