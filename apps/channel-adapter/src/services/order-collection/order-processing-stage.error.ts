import type { OrderProcessingStage } from './channel-order-provider.interface';

/**
 * 주문 하나를 처리하다 실패한 **단계**를 실어 나르는 내부 에러 (#1016 1번 행 스펙 §6.3).
 *
 * 처리 실패 행의 `failed_stage` 를 채우려면 throw 지점이 단계를 알려 줘야 한다. 바깥 계약(`syncOrder` 의
 * 호출자 — HTTP·명령 소비자)에는 `original` 을 그대로 다시 던진다. 이 타입은 channel-adapter 밖으로 나가지 않는다.
 */
export class OrderProcessingStageError extends Error {
  constructor(
    readonly stage: OrderProcessingStage,
    readonly original: unknown,
    readonly input: Record<string, unknown>,
  ) {
    super(errorMessage(original));
    this.name = 'OrderProcessingStageError';
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
