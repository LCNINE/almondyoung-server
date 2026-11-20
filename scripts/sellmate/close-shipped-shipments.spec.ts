import { CLOSEOUT_CTE, SCOPED_CLOSEOUT_CTE, closeoutStatements } from './close-shipped-shipments';

describe('close-shipped-shipments 종결 문장', () => {
  const statements = closeoutStatements(CLOSEOUT_CTE);
  const at = (needle: string) => statements.findIndex((s) => s.includes(needle));

  it('임시 표 둘 + UPDATE 다섯, 처음 문장이 CTE 를 담는다', () => {
    expect(statements).toHaveLength(7);
    expect(statements[0].trim().startsWith('CREATE TEMP TABLE closeout ON COMMIT DROP AS')).toBe(true);
    expect(statements[0]).toContain(CLOSEOUT_CTE);
    expect(statements[1]).toContain('CREATE TEMP TABLE closeout_reservation');
  });

  it('상자를 먼저 닫고 예약을 푼다 — 재시도 워커가 풀린 재고를 도로 먹지 않게', () => {
    expect(at('UPDATE shipments')).toBeGreaterThan(-1);
    expect(at('UPDATE shipments')).toBeLessThan(at('UPDATE stock_reservations'));
  });

  it('좁힌 CTE 는 대상 주문 표와 진행 중 작업 항목을 보고, recovery_required 상자는 닫지 않는다', () => {
    expect(SCOPED_CLOSEOUT_CTE).toContain('leftover_scope');
    expect(SCOPED_CLOSEOUT_CTE).toContain('outbound_batch_work_items');
    expect(SCOPED_CLOSEOUT_CTE).not.toContain('recovery_required');
  });
});
