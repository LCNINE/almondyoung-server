// 박스가 배치에서 나가며 송장을 무효화하는 명령의 멱등 키 — 송장 조회가 이 키로 «그 이탈이 무효화한 송장»을 찾는다.

/** 기다리던 취소가 박스를 내보내며 활성 송장을 무효화한다. */
export function cancellationVoidKey(operationId: string, shipmentId: string): string {
  return `cancel-exit:${operationId}:${shipmentId}`;
}

/** 관리자가 송장 무효화까지 골라 배치에서 뺀 박스의 송장을 커밋 뒤 무효화한다. */
export function withdrawalVoidKey(workItemId: string, waybillId: string): string {
  return `withdrawal-void:${workItemId}:${waybillId}`;
}
