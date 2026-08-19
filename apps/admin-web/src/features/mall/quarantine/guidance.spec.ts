import { actionForCause, canReplay, replayResultMessage } from './guidance';

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
  it('여섯 가지 결과를 모두 사람 말로 옮긴다', () => {
    const statuses = [
      'replayed',
      'already_processed',
      'still_quarantined',
      'closed_terminal',
      'closed_already_collected',
      'not_replayable',
    ] as const;
    for (const status of statuses) {
      expect(replayResultMessage(status).length).toBeGreaterThan(0);
    }
  });
});
