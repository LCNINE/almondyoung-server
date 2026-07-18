import { InboundService } from './inbound.service';

const SENTINEL = { sentinel: true };

function build() {
  const withIdempotency = jest.fn().mockResolvedValue(SENTINEL);
  const idempotency = { withIdempotency } as never;
  // 나머지 의존성은 withIdempotency 모킹으로 본문이 실행되지 않으므로 도달하지 않음
  const svc = new InboundService({} as never, {} as never, {} as never, {} as never, {} as never, idempotency);
  return { svc, withIdempotency };
}

const CASES: Array<{ method: keyof InboundService; endpoint: string; dto: Record<string, unknown> }> = [
  { method: 'simpleInbound', endpoint: 'inbound.simple', dto: { warehouseId: 'w', items: [], idempotencyKey: 'k' } },
  { method: 'simpleInboundFullscan', endpoint: 'inbound.simple-fullscan', dto: { warehouseId: 'w', items: [], idempotencyKey: 'k' } },
  { method: 'individualInbound', endpoint: 'inbound.individual', dto: { idempotencyKey: 'k' } },
  { method: 'receiveFromPlan', endpoint: 'inbound.plans.receive', dto: { idempotencyKey: 'k' } },
  { method: 'putawayFromOrigin', endpoint: 'inbound.putaway', dto: { idempotencyKey: 'k' } },
  { method: 'returnInbound', endpoint: 'inbound.return', dto: { idempotencyKey: 'k' } },
  { method: 'cancelInbound', endpoint: 'inbound.cancel', dto: { idempotencyKey: 'k' } },
];

describe('InboundService 멱등 래퍼 배선', () => {
  it.each(CASES)('$method → withIdempotency($endpoint, dto.idempotencyKey, dto)', async ({ method, endpoint, dto }) => {
    const { svc, withIdempotency } = build();
    // 배선 검증 목적의 동적 호출 — DTO 전체 형태는 통합 스펙에서 검증 (정당화 주석)
    const result = await (svc[method] as (d: unknown, tx?: unknown) => Promise<unknown>)(dto);
    expect(withIdempotency).toHaveBeenCalledWith(endpoint, 'k', dto, expect.any(Function), undefined);
    expect(result).toBe(SENTINEL);
  });
});
