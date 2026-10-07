import {
  actionForCause,
  canReplay,
  isProcessingFailure,
  reasonLabel,
  replayResultMessage,
  retryProgressLabel,
  stageLabel,
} from './guidance';

describe('actionForCause', () => {
  it('리스팅이 없으면 매핑 생성으로 안내한다', () => {
    expect(actionForCause('listing_not_found')).toEqual({
      label: '매핑 생성',
      action: 'create-listing',
      description: '이 채널상품에 대응하는 채널 리스팅을 만드세요.',
    });
  });

  it('활성 버전이 없으면 두 갈래를 다 알린다 — 판매중지를 publish 로 오도하지 않는다', () => {
    const guidance = actionForCause('no_active_version');
    expect(guidance.action).toBe('none');
    expect(guidance.description).toContain('publish');
    expect(guidance.description).toContain('내리세요');
  });

  it('모르는 값이 와도 렌더 가능한 안내를 준다', () => {
    expect(actionForCause('unknown').action).toBe('none');
  });
});

describe('canReplay', () => {
  it('격리 상태이고 식별 실패면 재처리할 수 있다', () => {
    expect(
      canReplay('quarantined', 'channel_product_identification_failed')
    ).toBe(true);
  });

  it('수집 후 변경은 재처리 대상이 아니다', () => {
    expect(
      canReplay('quarantined', 'collected_order_modification_not_accepted')
    ).toBe(false);
  });

  it('닫힌 건은 재처리하지 않는다', () => {
    expect(
      canReplay(
        'closed_already_collected',
        'channel_product_identification_failed'
      )
    ).toBe(false);
  });
});

describe('replayResultMessage', () => {
  it('일곱 가지 결과를 모두 사람 말로 옮긴다 (OrderPollerOrchestrator.replayFailure 의 전체 어휘)', () => {
    const statuses = [
      'replayed',
      'already_processed',
      'still_quarantined',
      'closed_terminal',
      'closed_already_collected',
      'not_found_or_not_payment_accepted',
      'not_replayable',
    ] as const;
    for (const status of statuses) {
      expect(replayResultMessage(status).length).toBeGreaterThan(0);
    }
  });

  it('채널에서 주문을 찾지 못하거나 결제완료가 아니면 그 사실을 그대로 말한다', () => {
    const message = replayResultMessage('not_found_or_not_payment_accepted');
    expect(message).toContain('찾을 수 없');
  });

  it('모르는 값이 와도 폴백 문구를 준다', () => {
    expect(replayResultMessage('some_unknown_status')).toBe(
      '알 수 없는 결과입니다.'
    );
  });
});

describe('reasonLabel', () => {
  it('식별 실패 사유를 사람 말로 옮긴다', () => {
    expect(reasonLabel('channel_product_identification_failed')).toBe(
      '채널상품 식별 실패'
    );
  });

  it('수집 후 변경 사유를 사람 말로 옮긴다', () => {
    expect(reasonLabel('collected_order_modification_not_accepted')).toBe(
      '수집 후 변경(재처리 불가)'
    );
  });

  it('모르는 값은 원본을 그대로 보여준다', () => {
    expect(reasonLabel('weird_new_reason')).toBe('weird_new_reason');
  });
});

describe('수집 처리 실패 (#1016 1번 행)', () => {
  it('사유 라벨이 있다', () => {
    expect(reasonLabel('order_collection_processing_failed')).toBe('수집 처리 실패');
    expect(isProcessingFailure('order_collection_processing_failed')).toBe(true);
    expect(isProcessingFailure('channel_product_identification_failed')).toBe(false);
  });

  it('재처리할 수 있다 — 재시도 중이어도 사람이 먼저 누를 수 있다', () => {
    expect(canReplay('quarantined', 'order_collection_processing_failed')).toBe(true);
  });

  it('단계 라벨을 옮기고, 모르는 값은 원문, 없으면 null', () => {
    expect(stageLabel('fetch')).toBe('조회 실패');
    expect(stageLabel('translate')).toBe('변환 실패');
    expect(stageLabel('enqueue_order')).toBe('주문 적재 실패');
    expect(stageLabel('enqueue_lifecycle')).toBe('취소·환불 적재 실패');
    expect(stageLabel('mystery')).toBe('mystery');
    expect(stageLabel(null)).toBeNull();
    expect(stageLabel(undefined)).toBeNull();
  });

  it('재시도 중일 때만 진행 라벨을 준다 — 소진·종결·다른 사유는 null', () => {
    const row = { reason: 'order_collection_processing_failed', status: 'quarantined' };
    expect(retryProgressLabel({ ...row, attemptCount: 1 })).toBe('자동 재시도 중 (1/4)');
    expect(retryProgressLabel({ ...row, attemptCount: 3 })).toBe('자동 재시도 중 (3/4)');
    expect(retryProgressLabel({ ...row, attemptCount: 4 })).toBeNull();
    expect(retryProgressLabel({ ...row, status: 'replayed', attemptCount: 1 })).toBeNull();
    expect(retryProgressLabel({ reason: 'channel_product_identification_failed', status: 'quarantined', attemptCount: 0 })).toBeNull();
  });

  it('식별 실패로 넘어간 replay 결과에 문구가 있다', () => {
    expect(replayResultMessage('moved_to_identification_quarantine')).toBe(
      '상품 식별 실패로 넘어갔습니다. 식별 실패 격리 행에서 조치하세요.'
    );
  });
});
