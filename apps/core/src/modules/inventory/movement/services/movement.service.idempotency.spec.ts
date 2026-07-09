import { MovementService } from './movement.service';

const SENTINEL = { sentinel: true };

function build() {
  const withIdempotency = jest.fn().mockResolvedValue(SENTINEL);
  // MovementService 생성자 시그니처는 파일 :12 확인 — idempotency 를 마지막 파라미터로 추가한 상태 기준
  const svc = new MovementService({} as never, {} as never, { withIdempotency } as never);
  return { svc, withIdempotency };
}

describe('MovementService 멱등 래퍼 배선', () => {
  it('moveImmediately → withIdempotency(movement.move, …) — 단, 사전 검증은 래퍼 밖', async () => {
    const { svc, withIdempotency } = build();
    // 사전 검증(로케이션 조회 등)을 통과시키기 어려우므로 검증 로직이 래퍼 앞에 있으면
    // 이 테스트는 검증 의존성 모킹이 필요 — 구현 시 검증도 래퍼 안(handler 첫머리)으로 이동해 단순화
    const dto = { warehouseId: 'w', lines: [], idempotencyKey: 'k' };
    const result = await svc.moveImmediately(dto as never);
    // 이 두 메서드는 tx? 파라미터가 없어 래퍼를 4개 인자로 호출 — 기대 인자 수를 맞춘다
    expect(withIdempotency).toHaveBeenCalledWith('movement.move', 'k', dto, expect.any(Function));
    expect(result).toBe(SENTINEL);
  });

  it('createInterWarehouseTransfer → withIdempotency(movement.inter-warehouse, …)', async () => {
    const { svc, withIdempotency } = build();
    const dto = { skuId: 's', fromWarehouseId: 'a', toWarehouseId: 'b', quantity: 1, idempotencyKey: 'k' };
    const result = await svc.createInterWarehouseTransfer(dto as never);
    expect(withIdempotency).toHaveBeenCalledWith('movement.inter-warehouse', 'k', dto, expect.any(Function));
    expect(result).toBe(SENTINEL);
  });
});
