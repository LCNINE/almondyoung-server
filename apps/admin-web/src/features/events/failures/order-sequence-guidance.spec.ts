import { orderSequenceGuidance } from './order-sequence-guidance';

const head = {
  id: 1,
  eventType: 'OrderCancelled',
  errorName: 'NotFoundException',
  errorMessage: 'Sales order order-A not found for OrderCancelled',
};

describe('orderSequenceGuidance', () => {
  it('뒤에 주문 생성이 있으면 재실행 순서를 설명한다', () => {
    expect(
      orderSequenceGuidance('core', head, [
        { id: 2, eventType: 'OrderCreated', status: 'held' },
      ])
    ).toContain('생성 후 취소');
  });

  it('생성 기록이 없으면 원본 수집과 종결 위험을 설명한다', () => {
    expect(orderSequenceGuidance('core', head, [])).toContain('원본 주문 수집');
    expect(orderSequenceGuidance('core', head, [])).toContain('종결하면');
  });

  it('생성 앞에 다른 보류 이벤트가 있으면 자동 순서 복구를 약속하지 않는다', () => {
    expect(
      orderSequenceGuidance('core', head, [
        { id: 2, eventType: 'OrderModified', status: 'held' },
        { id: 3, eventType: 'OrderCreated', status: 'held' },
      ])
    ).toContain('다른 이벤트');
  });

  it('다른 서비스나 실패에는 주문 복구 안내를 보이지 않는다', () => {
    expect(orderSequenceGuidance('channel-adapter', head, [])).toBeNull();
    expect(
      orderSequenceGuidance(
        'core',
        { ...head, errorName: 'BadRequestException' },
        []
      )
    ).toBeNull();
    expect(
      orderSequenceGuidance(
        'core',
        { ...head, errorMessage: 'Product not found' },
        []
      )
    ).toBeNull();
  });
});
