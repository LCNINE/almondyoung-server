import { AlimtalkAutoSendReader, toAutoSendItem } from './alimtalk-auto-send.reader';

const row = (over: Partial<Parameters<typeof toAutoSendItem>[0]> = {}): Parameters<typeof toAutoSendItem>[0] => ({
  notificationId: 'n1',
  eventKey: 'MEMBERSHIP_BILLING_ATTEMPT_FAILED',
  eventName: '멤버십 요금 출금 실패',
  status: 'SENT',
  createdAt: new Date('2026-10-01T13:30:11.000Z'),
  sentAt: new Date('2026-10-01T13:30:12.000Z'),
  payload: { name: '홍길동', phoneNumber: '01012345678' },
  metadata: {
    messageId: 'req-123',
    requestDate: '2026-10-02 08:00',
    templateCode: 'MEMB_BILL_FAIL',
    templateParameters: { name: '홍길동' },
  },
  errorDetails: null,
  ...over,
});

describe('자동 발송 기록 한 줄', () => {
  it('받는 분 이름·가린 번호·NHN 요청 번호·예약 시각을 뽑는다', () => {
    expect(toAutoSendItem(row())).toEqual({
      notificationId: 'n1',
      eventKey: 'MEMBERSHIP_BILLING_ATTEMPT_FAILED',
      eventName: '멤버십 요금 출금 실패',
      templateCode: 'MEMB_BILL_FAIL',
      recipientName: '홍길동',
      phone: '010-****-5678',
      status: 'SENT',
      createdAt: '2026-10-01T13:30:11.000Z',
      sentAt: '2026-10-01T13:30:12.000Z',
      scheduledFor: '2026-10-02 08:00',
      requestId: 'req-123',
      error: null,
    });
  });

  it('NHN 이 거절한 건은 거절 사유를 보여주고 요청 번호는 없다', () => {
    const item = toAutoSendItem(
      row({
        status: 'FAILED',
        sentAt: null,
        metadata: { templateCode: 'MEMB_BILL_FAIL', smsFallback: true },
        errorDetails: {
          message: 'Please set up plus-friend resend setting.',
          stack: 'Error: …',
          timestamp: new Date('2026-09-30T22:30:10.274Z'),
        },
      }),
    );
    expect(item.status).toBe('FAILED');
    expect(item.error).toBe('Please set up plus-friend resend setting.');
    expect(item.requestId).toBeNull();
    expect(item.scheduledFor).toBeNull();
  });

  it('이름이 payload 에 없으면 템플릿 변수의 이름을, 번호가 없으면 가린 자리표시를 쓴다', () => {
    const item = toAutoSendItem(row({ payload: {}, metadata: { templateParameters: { name: '김영희' } } }));
    expect(item.recipientName).toBe('김영희');
    expect(item.phone).toBe('');
    expect(item.templateCode).toBeNull();
  });
});

describe('자동 발송 결과 조회', () => {
  const reader = (found: ReturnType<typeof row> | undefined, messages: unknown[] = []) => {
    const listMessageResults = jest.fn().mockResolvedValue(messages);
    return {
      reader: new AlimtalkAutoSendReader(
        { findAutoSend: jest.fn().mockResolvedValue(found) } as never,
        { listMessageResults } as never,
      ),
      listMessageResults,
    };
  };

  it('NHN 이 받은 건은 요청 번호로 물어 카카오 도착(1000)을 돌려준다', async () => {
    const { reader: r, listMessageResults } = reader(row(), [
      {
        messageStatus: 'COMPLETED',
        resultCode: '1000',
        resultCodeName: '성공',
        resendStatus: 'RSC02',
        resendStatusName: '대체 발송 대상',
      },
    ]);
    await expect(r.result('n1')).resolves.toEqual({ notificationId: 'n1', outcome: 'kakao', detail: null });
    expect(listMessageResults).toHaveBeenCalledWith('req-123');
  });

  it('접수되지 않은 건은 NHN 에 묻지 않고 거절 사유를 돌려준다', async () => {
    const { reader: r, listMessageResults } = reader(
      row({
        status: 'FAILED',
        metadata: {},
        errorDetails: { message: '거절', timestamp: new Date('2026-09-30T22:30:10.274Z') },
      }),
    );
    await expect(r.result('n1')).resolves.toEqual({ notificationId: 'n1', outcome: 'NOT_ACCEPTED', detail: '거절' });
    expect(listMessageResults).not.toHaveBeenCalled();
  });

  it('없는 기록이면 404', async () => {
    await expect(reader(undefined).reader.result('nx')).rejects.toThrow('자동 발송 알림톡을 찾을 수 없습니다');
  });
});
