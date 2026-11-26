export function orderSequenceGuidance(
  service: string,
  row: {
    id: number;
    eventType: string | null;
    errorName: string | null;
    errorMessage: string | null;
  },
  sequence: ReadonlyArray<{
    id: number;
    eventType: string | null;
    status: string;
  }>
): string | null {
  if (
    service !== 'core' ||
    row.eventType !== 'OrderCancelled' ||
    row.errorName !== 'NotFoundException' ||
    !/^Sales order .+ not found for OrderCancelled$/.test(
      row.errorMessage ?? ''
    )
  ) {
    return null;
  }

  const unresolved = sequence
    .filter(
      (event) =>
        event.id > row.id &&
        (event.status === 'held' || event.status === 'failed')
    )
    .sort((left, right) => left.id - right.id);
  const next = unresolved[0];

  if (next?.eventType === 'OrderCreated') {
    return '주문 생성이 뒤에서 대기 중입니다. 다시 넣기를 누르면 생성 후 취소를 순서대로 처리합니다. 종결하면 취소는 처리되지 않습니다.';
  }

  if (unresolved.some((event) => event.eventType === 'OrderCreated')) {
    return '주문 생성 앞에 다른 이벤트가 대기 중입니다. 자동 순서 복구를 진행하지 않고 원본 주문과 이벤트를 확인하세요. 종결하면 이 취소 기록은 처리되지 않습니다.';
  }

  return '주문 생성 기록이 없습니다. 원본 주문 수집을 확인한 뒤 다시 넣으세요. 종결하면 이 취소 기록은 처리되지 않습니다.';
}
