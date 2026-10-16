import {
  REASON_MAX,
  actionErrorText,
  actionLabel,
  discardFollowUpText,
  discardResultText,
  dwellSince,
  errorMessageOf,
  errorOneLine,
  isStopped,
  isUnresolved,
  loadErrorText,
  reasonError,
  redriveAllConfirmText,
  redriveAllResultText,
  redriveResultText,
  resendAllConfirmText,
  resendAllResultText,
  resendResultText,
  statusLabel,
  stopDetail,
  tabBadgeCount,
} from './display';
import type { EventFailuresSummary } from '@/lib/api/domains/events/failures.types';

const summary = (dl: { failed: number; held: number }, outboxFailed: number): EventFailuresSummary => ({
  deadLetters: { ...dl, oldestFailedAt: null },
  outbox: { failed: outboxFailed, oldestFailedAt: null },
});

describe('dwellSince', () => {
  const now = new Date('2026-10-15T12:00:00Z');

  it('정체 보드와 같은 표기로 체류를 적는다', () => {
    expect(dwellSince('2026-10-15T10:30:00Z', now)).toBe('1시간 30분');
    expect(dwellSince('2026-10-13T12:00:00Z', now)).toBe('2일');
  });

  it('시각이 없으면 줄표', () => {
    expect(dwellSince(null, now)).toBe('-');
  });

  it('시계가 어긋나 미래 시각이 와도 음수를 보이지 않는다', () => {
    expect(dwellSince('2026-10-15T12:05:00Z', now)).toBe('0분');
  });
});

describe('errorOneLine', () => {
  it('이름과 첫 줄을 잇는다', () => {
    expect(errorOneLine('TimeoutError', 'upstream timed out\n    at foo (bar.ts:1)')).toBe(
      'TimeoutError: upstream timed out'
    );
  });

  it('긴 메시지는 120자에서 자르고 말줄임표를 붙인다', () => {
    const line = errorOneLine(null, 'x'.repeat(300));
    expect(line).toHaveLength(121);
    expect(line.endsWith('…')).toBe(true);
  });

  it('앞쪽 빈 줄은 건너뛴다', () => {
    expect(errorOneLine(null, '\n\n  real cause  \nmore')).toBe('real cause');
  });

  it('둘 다 없으면 줄표, 이름만 있으면 이름', () => {
    expect(errorOneLine(null, null)).toBe('-');
    expect(errorOneLine('ZodError', null)).toBe('ZodError');
  });
});

describe('errorMessageOf / loadErrorText', () => {
  it('서버 문구를 그대로 보여 준다 — 409 «이미 진행 중» 같은 이유가 사람에게 닿게', () => {
    const err = new Error('DeadLetterRuntime 이 시작되지 않았다 — ② 마이그 …');
    expect(errorMessageOf(err)).toBe('DeadLetterRuntime 이 시작되지 않았다 — ② 마이그 …');
    expect(loadErrorText(err)).toBe('불러오지 못했습니다 — DeadLetterRuntime 이 시작되지 않았다 — ② 마이그 …');
  });

  it('Error 가 아니면 일반 문구', () => {
    expect(errorMessageOf('boom')).toBe('요청이 실패했습니다');
    expect(loadErrorText(undefined)).toBe('불러오지 못했습니다 — 요청이 실패했습니다');
  });
});

describe('redriveResultText', () => {
  it('끝까지 처리했으면 건수', () => {
    expect(redriveResultText({ processed: 3, stoppedAt: null })).toBe('3건 처리');
  });

  it('멈췄으면 멈춘 사실과 오류 이름을 숨기지 않는다', () => {
    const r = { processed: 1, stoppedAt: { id: 9, errorName: 'TimeoutError', errorMessage: 'x' } };
    expect(redriveResultText(r)).toBe('1건 처리 후 멈춤 — TimeoutError');
    expect(isStopped(r)).toBe(true);
  });

  it('처음 행에서 멈추면 0건 처리 후 멈춤', () => {
    expect(redriveResultText({ processed: 0, stoppedAt: { id: 9, errorName: null, errorMessage: null } })).toBe(
      '0건 처리 후 멈춤 — 오류'
    );
  });

  it('처리할 게 없었으면 그렇게 말한다', () => {
    expect(redriveResultText({ processed: 0, stoppedAt: null })).toBe('처리할 것이 없습니다');
    expect(isStopped({ processed: 0, stoppedAt: null })).toBe(false);
  });
});

describe('discardResultText', () => {
  it('머리 아닌 행 종결 — 아무것도 흐르지 않았다', () => {
    expect(discardResultText({ processed: 0, stoppedAt: null })).toBe('종결');
  });

  it('머리 종결 뒤 이어서 처리된 건수', () => {
    expect(discardResultText({ processed: 2, stoppedAt: null })).toBe('종결 · 뒤 2건 처리');
  });

  it('이어서 처리하다 멈췄으면 멈춤을 알린다', () => {
    expect(
      discardResultText({ processed: 1, stoppedAt: { id: 5, errorName: 'ConflictError', errorMessage: null } })
    ).toBe('종결 · 뒤 1건 처리 후 멈춤 — ConflictError');
  });
});

describe('redriveAllResultText', () => {
  it('성공·멈춤(오류 이름별, 많은 순)·건너뜀을 한 문장으로', () => {
    expect(
      redriveAllResultText({
        sequences: 13,
        succeeded: 10,
        stopped: 3,
        busy: 0,
        stoppedByError: { ZodError: 1, TimeoutError: 2 },
      })
    ).toBe('성공 10 · 멈춤 3 (TimeoutError 2, ZodError 1)');
  });

  it('진행 중이라 건너뛴 순서를 센다', () => {
    expect(
      redriveAllResultText({ sequences: 2, succeeded: 1, stopped: 0, busy: 1, stoppedByError: {} })
    ).toBe('성공 1 · 진행 중이라 건너뜀 1');
  });

  it('순서가 없었으면', () => {
    expect(redriveAllResultText({ sequences: 0, succeeded: 0, stopped: 0, busy: 0, stoppedByError: {} })).toBe(
      '다시 넣을 것이 없습니다'
    );
  });
});

describe('resendResultText / resendAllResultText', () => {
  it('단건', () => {
    expect(resendResultText({ status: 'PUBLISHED' })).toBe('보냈습니다');
    expect(resendResultText({ status: 'FAILED', error: 'KafkaJSConnectionError\nstack' })).toBe(
      '실패 — KafkaJSConnectionError'
    );
  });

  it('전체 — 그 사이 다른 사람이 처리한 행은 건너뜀으로 센다', () => {
    expect(resendAllResultText({ total: 5, published: 3, failed: [{ id: 1, error: 'x' }] })).toBe(
      '성공 3 · 실패 1 · 건너뜀 1'
    );
    expect(resendAllResultText({ total: 2, published: 2, failed: [] })).toBe('성공 2');
    expect(resendAllResultText({ total: 0, published: 0, failed: [] })).toBe('다시 보낼 것이 없습니다');
  });
});

describe('discardFollowUpText', () => {
  it('뒤에 기다리는 게 있으면 이어서 처리된다고 미리 알린다', () => {
    expect(discardFollowUpText(2)).toBe('뒤 2건이 이어서 처리됩니다');
  });

  it('없으면 아무 문구도 없다 — 머리 아닌 행 종결에 거짓 안내를 하지 않는다', () => {
    expect(discardFollowUpText(0)).toBeNull();
  });
});

describe('reasonError', () => {
  it('공백뿐이면 거부', () => {
    expect(reasonError('   ')).toBe('사유를 입력하세요');
  });

  it(`${REASON_MAX}자까지 허용, 넘으면 거부(앞뒤 공백은 세지 않는다)`, () => {
    expect(reasonError('a'.repeat(REASON_MAX))).toBeNull();
    expect(reasonError(`  ${'a'.repeat(REASON_MAX)}  `)).toBeNull();
    expect(reasonError('a'.repeat(REASON_MAX + 1))).toBe(`${REASON_MAX}자 이내로 입력하세요`);
  });
});

describe('tabBadgeCount', () => {
  it('안 푼 컨슈머 실패(failed+held)와 outbox FAILED 의 합', () => {
    expect(tabBadgeCount(summary({ failed: 2, held: 3 }, 4))).toBe(9);
  });

  it('요약이 없으면 null — 0 으로 보이면 «정상»으로 오독한다', () => {
    expect(tabBadgeCount(undefined)).toBeNull();
  });
});

describe('확인 문구', () => {
  it('전체 다시 넣기', () => {
    expect(redriveAllConfirmText(summary({ failed: 4, held: 6 }, 0))).toBe(
      '실패 4건 · 보류 6건을 순서마다 다시 넣습니다'
    );
    expect(redriveAllConfirmText(summary({ failed: 4, held: 0 }, 0))).toBe('실패 4건을 순서마다 다시 넣습니다');
    expect(redriveAllConfirmText(undefined)).toBe('안 푼 실패를 순서마다 다시 넣습니다');
  });

  it('전체 다시 보내기', () => {
    expect(resendAllConfirmText(summary({ failed: 0, held: 0 }, 7))).toBe('7건을 오래된 순서로 다시 보냅니다');
    expect(resendAllConfirmText(undefined)).toBe('실패한 행을 오래된 순서로 다시 보냅니다');
  });
});

describe('statusLabel / isUnresolved / actionLabel', () => {
  it('상태 이름', () => {
    expect(statusLabel('failed')).toBe('실패');
    expect(statusLabel('held')).toBe('보류');
    expect(statusLabel('redriven')).toBe('다시 넣음');
    expect(statusLabel('discarded')).toBe('종결');
    expect(statusLabel('weird')).toBe('weird');
  });

  it('안 푼 상태는 failed·held 뿐', () => {
    expect(isUnresolved('failed')).toBe(true);
    expect(isUnresolved('held')).toBe(true);
    expect(isUnresolved('redriven')).toBe(false);
    expect(isUnresolved('discarded')).toBe(false);
  });

  it('조치 이름 — outbox 의 redrive 는 «다시 보내기»', () => {
    expect(actionLabel('dead_letter', 'redrive', 'succeeded')).toBe('다시 넣기');
    expect(actionLabel('dead_letter', 'redrive', 'failed')).toBe('다시 넣기 실패');
    expect(actionLabel('outbox', 'redrive', 'succeeded')).toBe('다시 보내기');
    expect(actionLabel('outbox', 'redrive', 'failed')).toBe('다시 보내기 실패');
    expect(actionLabel('outbox', 'discard', 'succeeded')).toBe('종결');
  });
});

describe('stopDetail', () => {
  it('멈춘 이유를 한 줄로 — 디스패치 단계에서 멈추면 이름은 그냥 Error 라 메시지가 진단이다', () => {
    expect(
      stopDetail({
        processed: 0,
        stoppedAt: {
          id: 3,
          errorName: 'Error',
          errorMessage: '핸들러가 실행되지 않았다 — 이벤트 종류·핸들러 이름이 바뀌었는지 확인',
        },
      })
    ).toBe('Error: 핸들러가 실행되지 않았다 — 이벤트 종류·핸들러 이름이 바뀌었는지 확인');
  });

  it('멈추지 않았으면 없다', () => {
    expect(stopDetail({ processed: 2, stoppedAt: null })).toBeUndefined();
  });
});

describe('actionErrorText', () => {
  it('프록시가 30초에서 끊은 504 — 서버는 계속 처리하므로 실패라고 말하지 않는다', () => {
    const timeout = Object.assign(new Error('Upstream request timed out after 30000ms'), { statusCode: 504 });
    expect(actionErrorText(timeout)).toBe('서버에서 계속 처리 중입니다 — 잠시 뒤 새로 읽으세요');
  });

  it('그 밖의 오류는 서버 문구 그대로', () => {
    const conflict = Object.assign(new Error('이 순서를 이미 다시 넣는 작업이 진행 중이다'), { statusCode: 409 });
    expect(actionErrorText(conflict)).toBe('이 순서를 이미 다시 넣는 작업이 진행 중이다');
    expect(actionErrorText(undefined)).toBe('요청이 실패했습니다');
  });
});
