import type { ReconcileFindingDto } from '@/lib/api/domains/channel/order-reconcile-findings.shape';
import {
  MEMO_MAX,
  actionErrorText,
  canAct,
  emptyText,
  firstSeenText,
  handlingText,
  kindLabel,
  lastResultText,
  memoError,
  mismatchActionError,
  orderNoOf,
  redeliverOutcome,
} from './display';

const base: ReconcileFindingDto = {
  id: 'f1',
  channel: 'medusa',
  externalOrderId: 'order_01',
  displayOrderNo: '1042',
  kind: 'missing_order',
  status: 'open',
  handling: 'human',
  humanReason: 'out_of_window',
  coreStatus: null,
  channelCreatedAt: '2026-10-01T00:00:00.000Z',
  mode: 'observe',
  lastResult: 'skipped',
  attemptCount: 0,
  firstSeenAt: '2026-10-16T09:30:00.000Z',
  lastSeenAt: '2026-10-16T10:00:00.000Z',
  lastAttemptAt: null,
  resolvedAt: null,
  closedAt: null,
  closedBy: null,
  closeMemo: null,
};

describe('주문번호·종류', () => {
  it('표시 번호가 없으면 채널 주문 id', () => {
    expect(orderNoOf(base)).toBe('1042');
    expect(orderNoOf({ ...base, displayOrderNo: null })).toBe('order_01');
  });
  it('두 종류의 한국어 이름, 모르는 값은 그대로', () => {
    expect(kindLabel('missing_order')).toBe('core 에 없음');
    expect(kindLabel('cancel_not_applied')).toBe('취소 미반영');
    expect(kindLabel('something_new')).toBe('something_new');
  });
});

describe('handlingText — 처리 칸', () => {
  it('자동', () => {
    expect(handlingText({ ...base, handling: 'auto', humanReason: null })).toBe(
      '자동'
    );
  });
  it('사람 — 사유 넷', () => {
    expect(handlingText(base)).toBe('사람 — 3일 지난 주문');
    expect(handlingText({ ...base, humanReason: 'event_failure_open' })).toBe(
      '사람 — 이벤트 실패 열림'
    );
    expect(handlingText({ ...base, humanReason: 'attempts_exhausted' })).toBe(
      '사람 — 시도 3회 소진'
    );
  });
  it('core 상태 사유엔 그 상태를 붙인다 — 출고됨인지 보고 종결을 판단한다', () => {
    expect(
      handlingText({
        ...base,
        kind: 'cancel_not_applied',
        humanReason: 'core_status',
        coreStatus: 'shipped',
      })
    ).toBe('사람 — core 가 취소를 못 받음 (shipped)');
  });
  it('해소·종결 행은 상태가 처리 칸을 대신한다', () => {
    expect(handlingText({ ...base, status: 'resolved' })).toBe('해소');
    expect(
      handlingText({ ...base, status: 'closed', closeMemo: '셀메이트로 나감' })
    ).toBe('종결 — 셀메이트로 나감');
    expect(handlingText({ ...base, status: 'closed' })).toBe('종결');
  });
});

describe('lastResultText — 마지막 결과', () => {
  it('관찰 모드와 자동 경로의 값', () => {
    expect(lastResultText('would_act')).toBe('관찰 — 보내지 않음');
    expect(lastResultText('skipped')).toBe('건너뜀');
    expect(lastResultText('enqueued')).toBe('보냄');
  });
  it('다시 배달의 결과 어휘', () => {
    expect(lastResultText('created')).toBe('수집함');
    expect(lastResultText('not_found')).toBe('채널에 없음');
    expect(lastResultText('nothing_to_send')).toBe('보낼 취소 없음');
    expect(lastResultText('no_mapping')).toBe('매핑 없음');
  });
  it('오류는 접두사를 바꿔 보인다', () => {
    expect(lastResultText('error: core lookup 503')).toBe(
      '오류 — core lookup 503'
    );
  });
  it('없으면 -, 모르는 값은 그대로', () => {
    expect(lastResultText(null)).toBe('-');
    expect(lastResultText('brand_new')).toBe('brand_new');
  });
});

describe('canAct — 조치 버튼은 열린 사람 행에만 (스펙 §8.2)', () => {
  it.each([
    [{ status: 'open', handling: 'human' }, true],
    [{ status: 'open', handling: 'auto' }, false],
    [{ status: 'resolved', handling: 'human' }, false],
    [{ status: 'closed', handling: 'human' }, false],
  ] as const)('%o → %s', (patch, expected) => {
    expect(canAct({ ...base, ...patch })).toBe(expected);
  });
});

describe('redeliverOutcome — 다시 배달 결과 토스트', () => {
  it('보냈거나 수집했으면 성공', () => {
    expect(redeliverOutcome('enqueued')).toEqual({
      tone: 'success',
      text: '보냈습니다',
    });
    expect(redeliverOutcome('emitted')).toEqual({
      tone: 'success',
      text: '보냈습니다',
    });
    expect(redeliverOutcome('created')).toEqual({
      tone: 'success',
      text: '수집했습니다',
    });
  });
  it('200 이어도 아무것도 안 보냈으면 오류 톤 — 성공으로 보이면 운영자가 떠난다', () => {
    expect(redeliverOutcome('not_found')).toEqual({
      tone: 'error',
      text: '보내지 않음 — 채널에 없음',
    });
    expect(redeliverOutcome('unchanged')).toEqual({
      tone: 'error',
      text: '보내지 않음 — 변경 없음',
    });
    expect(redeliverOutcome('nothing_to_send').tone).toBe('error');
  });
});

describe('memoError — 종결 메모', () => {
  it('비었거나 공백뿐이면 오류', () => {
    expect(memoError('')).toBe('메모를 입력하세요');
    expect(memoError('   ')).toBe('메모를 입력하세요');
  });
  it('500자까지', () => {
    expect(MEMO_MAX).toBe(500);
    expect(memoError('a'.repeat(500))).toBeNull();
    expect(memoError('a'.repeat(501))).toBe('500자 이내로 입력하세요');
  });
});

describe('그 밖', () => {
  it('첫 발견은 지난 시간', () => {
    expect(
      firstSeenText(
        '2026-10-16T09:30:00.000Z',
        new Date('2026-10-16T11:30:00.000Z')
      )
    ).toBe('2시간 전');
    // 시계가 어긋나 미래 시각이면 0분
    expect(
      firstSeenText(
        '2026-10-16T12:00:00.000Z',
        new Date('2026-10-16T11:30:00.000Z')
      )
    ).toBe('0분 전');
  });
  it('빈 목록 문구', () => {
    expect(emptyText('open')).toBe('어긋난 주문 없음');
    expect(emptyText('all')).toBe('기록 없음');
  });
  it('409 문구는 그대로, 504 는 «처리 중»', () => {
    const conflict = Object.assign(
      new Error('이미 core 에 반영돼 있다 — 다음 대사 주기에 해소로 닫힌다'),
      { statusCode: 409 }
    );
    expect(actionErrorText(conflict)).toBe(
      '이미 core 에 반영돼 있다 — 다음 대사 주기에 해소로 닫힌다'
    );
    const timeout = Object.assign(new Error('timeout'), { statusCode: 504 });
    expect(actionErrorText(timeout)).toBe(
      '서버에서 계속 처리 중입니다 — 잠시 뒤 새로 읽으세요'
    );
  });
});

describe('mismatchActionError — 조치 실패', () => {
  it('404 는 그 사이 대사가 해소했거나 누가 종결한 것 — 한국어로 알리고 대화상자를 닫는다', () => {
    const gone = Object.assign(
      new Error('Open reconcile finding not found: f1'),
      { statusCode: 404 }
    );
    expect(mismatchActionError(gone)).toEqual({
      text: '이미 해소·종결된 행입니다',
      gone: true,
    });
  });
  it('그 밖은 이벤트 실패 화면과 같은 규칙(409 문구 그대로)이고 대화상자는 남긴다', () => {
    const conflict = Object.assign(
      new Error('이 주문의 이벤트가 아직 나가는 중이다'),
      { statusCode: 409 }
    );
    expect(mismatchActionError(conflict)).toEqual({
      text: '이 주문의 이벤트가 아직 나가는 중이다',
      gone: false,
    });
  });
});
