import {
  actionFailureMessage,
  pendingOutcomeNotice,
} from './shipment-action-copy';

const conflict = (code: string, message: string) => ({
  statusCode: 409,
  message,
  response: { code, message },
});

describe('actionFailureMessage', () => {
  it('explains a rejected box action without the server text', () => {
    expect(
      actionFailureMessage(
        conflict('SHIPMENT_NOT_DRAFT', 'Shipment s-1 must be Draft to split'),
        'split'
      )
    ).toBe(
      '계획 전 상자만 나눌 수 있어요. 새로고침해 상자 상태를 확인해 주세요.'
    );
    expect(
      actionFailureMessage(
        conflict(
          'SHIPMENT_STALE_MANIFEST_VERSION',
          'Shipment s-1 manifest has changed'
        ),
        'recipient'
      )
    ).toBe(
      '그사이 다른 작업으로 상자가 바뀌었어요. 새로고침한 뒤 다시 해 주세요.'
    );
    expect(
      actionFailureMessage(
        conflict(
          'SHIPMENT_REOPEN_REQUIRED',
          'Recipient can only be revised on a Draft shipment'
        ),
        'recipient'
      )
    ).toBe(
      '계획을 확정한 상자라 여기서 받는 분을 바꿀 수 없어요. 새로고침해 상자 상태를 확인해 주세요.'
    );
  });

  it('keeps a Korean reason and hides an unknown English one', () => {
    expect(
      actionFailureMessage(
        conflict('SOMETHING_NEW', '재고가 모자라요.'),
        'plan'
      )
    ).toContain('재고가 모자라요.');
    const unknown = actionFailureMessage(
      conflict('SOMETHING_NEW', 'Shipment s-1 is weird'),
      'plan'
    );
    expect(unknown).toBe(
      '계획 확정을 하지 못했어요. 새로고침해 상자 상태를 확인한 뒤 다시 해 주세요.'
    );
  });

  it('keeps the transport message the API client already wrote', () => {
    const noResponse = {
      statusCode: 500,
      message: '응답을 받지 못해 처리됐는지 알 수 없어요.',
    };
    expect(actionFailureMessage(noResponse, 'split')).toBe(
      '응답을 받지 못해 처리됐는지 알 수 없어요.'
    );
  });
});

describe('pendingOutcomeNotice', () => {
  const sentAt = new Date('2026-11-12T06:12:00Z').getTime();

  it('says a processed request is done, with when', () => {
    const notice = pendingOutcomeNotice('split', sentAt, {
      processed: true,
      operationId: 'op-1',
      status: 'completed',
      completedAt: '2026-11-12T06:12:03Z',
    });
    expect(notice.tone).toBe('done');
    expect(notice.text).toMatch(
      /^앞서 보낸 상자 분할 요청은 처리됐어요\(.+\)\./
    );
  });

  it('says an unprocessed request was not applied once enough time has passed', () => {
    const notice = pendingOutcomeNotice(
      'recipient',
      sentAt,
      { processed: false, operationId: null, status: null, completedAt: null },
      sentAt + 60_000
    );
    expect(notice).toEqual({
      tone: 'not_processed',
      text: '앞서 보낸 수령인 변경 요청은 처리되지 않았어요. 필요하면 다시 해 주세요.',
    });
  });

  it('does not conclude too early while the request may still be running', () => {
    const notice = pendingOutcomeNotice(
      'recipient',
      sentAt,
      { processed: false, operationId: null, status: null, completedAt: null },
      sentAt + 5_000
    );
    expect(notice.tone).toBe('checking');
  });

  it('says the server is still working on a processed but unfinished request', () => {
    expect(
      pendingOutcomeNotice('plan', sentAt, {
        processed: true,
        operationId: 'op-1',
        status: 'in_progress',
        completedAt: null,
      }).tone
    ).toBe('checking');
    expect(
      pendingOutcomeNotice('plan', sentAt, {
        processed: true,
        operationId: 'op-1',
        status: 'recovery_required',
        completedAt: null,
      })
    ).toEqual({
      tone: 'attention',
      text: '앞서 보낸 계획 확정 요청은 서버가 끝내지 못했어요. 아래 작업 기록에서 상태를 확인해 주세요.',
    });
  });
});
