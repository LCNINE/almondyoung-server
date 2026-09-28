import {
  CarrierError,
  type AllocateResult,
  type CarrierGateway,
  type RegisterOutcome,
  type WaybillRequest,
} from './carrier/carrier-gateway.interface';
import { CarrierGatewayRegistry } from './carrier/carrier-gateway.registry';
import { WaybillIssueMachine, nextAttemptFrom } from './waybill-issue.machine';
import { WAYBILL } from './waybill.constants';
import type { WaybillRow } from './waybill.types';
import type { DbService } from '@app/db';
import type { WaybillRepository } from './waybill.repository';

const REQ = {} as WaybillRequest;
const runNoTx = { run: <T>(fn: (t: unknown) => Promise<T>) => fn({}) } as unknown as DbService<never>;

// 인메모리 fake repo: 단일 행 상태를 들고 CAS 시맨틱을 재현.
function fakeRepo(initial: Partial<WaybillRow>): { repo: WaybillRepository; row: WaybillRow } {
  const row = {
    id: 'w1',
    status: 'pending',
    attempts: 0,
    transientAttempts: 0,
    nextAttemptAt: null,
    trackingNo: null,
    ...initial,
  } as WaybillRow;
  const repo = {
    findById: () => Promise.resolve(row),
    casToAllocated: (_t: unknown, _id: string, tn: string, ld: Record<string, unknown>) => {
      if (row.status !== 'pending') return Promise.resolve(false);
      Object.assign(row, { status: 'allocated', trackingNo: tn, labelData: ld });
      return Promise.resolve(true);
    },
    casToRegistered: () => {
      if (row.status !== 'allocated') return Promise.resolve(false);
      Object.assign(row, { status: 'registered', issuedAt: new Date() });
      return Promise.resolve(true);
    },
    casToFailed: (_t: unknown, _id: string, err: string) => {
      if (!['pending', 'allocated'].includes(row.status)) return Promise.resolve(false);
      Object.assign(row, { status: 'failed', lastError: err });
      return Promise.resolve(true);
    },
    casToAbandoned: (_t: unknown, _id: string, from: string, lastError?: string) => {
      if (row.status !== from) return Promise.resolve(false);
      Object.assign(row, { status: 'abandoned', ...(lastError === undefined ? {} : { lastError }) });
      return Promise.resolve(true);
    },
    casToTransientPending: (_t: unknown, _id: string, err: string, next: Date) => {
      if (row.status !== 'pending') return Promise.resolve(false);
      Object.assign(row, { lastError: err, nextAttemptAt: next, transientAttempts: row.transientAttempts + 1 });
      return Promise.resolve(true);
    },
    incrementAttempts: () => {
      row.attempts += 1;
      return Promise.resolve();
    },
  } as unknown as WaybillRepository;
  return { repo, row };
}

function gatewayOf(over: Partial<CarrierGateway>): CarrierGatewayRegistry {
  const g = {
    carrier: 'HANJIN',
    capabilities: {} as never,
    isConfigured: () => true,
    allocate: (): Promise<AllocateResult> => Promise.resolve({ waybillNo: 'WBL1', labelData: { s_tml_cod: 'x' } }),
    register: (): Promise<RegisterOutcome> => Promise.resolve({ kind: 'registered' }),
    ...over,
  } as CarrierGateway;
  return new CarrierGatewayRegistry([g]);
}

describe('WaybillIssueMachine.drive', () => {
  it('pending → allocated → registered on happy path', async () => {
    const { repo, row } = fakeRepo({ carrier: 'HANJIN' });
    const machine = new WaybillIssueMachine(repo, gatewayOf({}), runNoTx);
    const out = await machine.drive(row.id, REQ);
    expect(out.status).toBe('registered');
    expect(out.trackingNo).toBe('WBL1');
  });

  it('already_registered(ERROR-09) is treated as registered', async () => {
    const { repo, row } = fakeRepo({ carrier: 'HANJIN', status: 'allocated', trackingNo: 'WBL1' });
    const machine = new WaybillIssueMachine(
      repo,
      gatewayOf({ register: (): Promise<RegisterOutcome> => Promise.resolve({ kind: 'already_registered' }) }),
      runNoTx,
    );
    expect((await machine.drive(row.id, REQ)).status).toBe('registered');
  });

  // ERROR-05/06 은 «일시적»이라 이 자리에 쓰면 안 된다 — 영구 거절의 예시는 ERROR-04(주소 정제 실패)다.
  it('allocate definitive_rejection → failed', async () => {
    const { repo, row } = fakeRepo({ carrier: 'HANJIN' });
    const machine = new WaybillIssueMachine(
      repo,
      gatewayOf({
        allocate: () => {
          throw new CarrierError('nope', 'definitive_rejection', { code: 'ERROR-04' });
        },
      }),
      runNoTx,
    );
    const out = await machine.drive(row.id, REQ);
    expect(out.status).toBe('failed');
    expect(out.lastError).toContain('ERROR-04');
  });

  // #914 의 본체: 시간이 지나면 풀리는 사유를 종료상태로 만들지 않는다.
  it('allocate transient_rejection(ERROR-05) → pending 유지, casToFailed 호출 없음', async () => {
    const { repo, row } = fakeRepo({ carrier: 'HANJIN' });
    const casToFailed = jest.spyOn(repo, 'casToFailed');
    const machine = new WaybillIssueMachine(
      repo,
      gatewayOf({
        allocate: () => {
          throw new CarrierError('daily limit', 'transient_rejection', {
            code: 'ERROR-05',
            retryAfter: { kind: 'next_day' },
          });
        },
      }),
      runNoTx,
    );
    const out = await machine.drive(row.id, REQ);
    expect(out.status).toBe('pending');
    expect(casToFailed).not.toHaveBeenCalled();
    expect(out.lastError).toContain('ERROR-05');
    expect(out.nextAttemptAt).toBeInstanceOf(Date);
    expect(out.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    // pending CAP 은 결과 불명(unknown_outcome) 전용 — 일시적 거절이 갉아먹으면 안 된다.
    expect(out.attempts).toBe(0);
    expect(out.transientAttempts).toBe(1);
  });

  // 탈출구: 무한 pending 은 활성 슬롯을 영구히 붙들어 재발급·수기등록을 전부 막는다.
  it('transient 가 전용 CAP 에 도달하면 사유를 남기고 failed 로 종료한다', async () => {
    const { repo, row } = fakeRepo({ carrier: 'HANJIN', transientAttempts: WAYBILL.TRANSIENT_ATTEMPTS_CAP - 1 });
    const machine = new WaybillIssueMachine(
      repo,
      gatewayOf({
        allocate: () => {
          throw new CarrierError('region blocked', 'transient_rejection', { code: 'ERROR-06' });
        },
      }),
      runNoTx,
    );
    const out = await machine.drive(row.id, REQ);
    expect(out.status).toBe('failed');
    expect(out.lastError).toContain(WAYBILL.ERROR.TRANSIENT_CAP_EXCEEDED);
  });

  it('register rejected → failed with reason', async () => {
    const { repo, row } = fakeRepo({ carrier: 'HANJIN', status: 'allocated', trackingNo: 'WBL1' });
    const machine = new WaybillIssueMachine(
      repo,
      gatewayOf({
        register: (): Promise<RegisterOutcome> => Promise.resolve({ kind: 'rejected', reason: 'BAD_ADDR' }),
      }),
      runNoTx,
    );
    const out = await machine.drive(row.id, REQ);
    expect(out.status).toBe('failed');
    expect(out.lastError).toContain('BAD_ADDR');
  });

  it('pending unknown_outcome bumps attempts and stays pending; auto-abandons at CAP', async () => {
    const { repo, row } = fakeRepo({ carrier: 'HANJIN', attempts: WAYBILL.PENDING_ATTEMPTS_CAP - 1 });
    const machine = new WaybillIssueMachine(
      repo,
      gatewayOf({
        allocate: () => {
          throw new CarrierError('timeout', 'unknown_outcome');
        },
      }),
      runNoTx,
    );
    const out = await machine.drive(row.id, REQ);
    expect(out.attempts).toBe(WAYBILL.PENDING_ATTEMPTS_CAP);
    expect(out.status).toBe('abandoned'); // CAP 도달 → 자동 포기(안전)
  });

  it('allocated unknown_outcome bumps attempts, stays allocated, NEVER auto-abandons', async () => {
    const { repo, row } = fakeRepo({ carrier: 'HANJIN', status: 'allocated', trackingNo: 'WBL1', attempts: 99 });
    const machine = new WaybillIssueMachine(
      repo,
      gatewayOf({
        register: () => {
          throw new CarrierError('timeout', 'unknown_outcome');
        },
      }),
      runNoTx,
    );
    const out = await machine.drive(row.id, REQ);
    expect(out.status).toBe('allocated'); // 이중등록 위험 → 자동 포기 금지
    expect(out.attempts).toBe(100);
  });

  it('terminal states are no-op', async () => {
    const { repo, row } = fakeRepo({ carrier: 'HANJIN', status: 'registered', trackingNo: 'WBL1' });
    const machine = new WaybillIssueMachine(repo, gatewayOf({}), runNoTx);
    expect((await machine.drive(row.id, REQ)).status).toBe('registered');
  });
});

// 런타임 TZ 에 기대면 서울 개발머신에서만 통과한다 — jest 는 UTC 로 뜨고 라이브도 UTC 다.
describe('nextAttemptFrom', () => {
  it('next_day 는 다음 KST 자정이다 (= 15:00Z)', () => {
    // 2026-09-21 05:00Z = KST 14:00 → 다음 KST 자정 = 2026-09-21 15:00Z
    expect(nextAttemptFrom({ kind: 'next_day' }, new Date('2026-09-21T05:00:00Z')).toISOString()).toBe(
      '2026-09-21T15:00:00.000Z',
    );
    // 2026-09-21 16:00Z = KST 다음날 01:00 → 다음 KST 자정 = 2026-09-22 15:00Z
    expect(nextAttemptFrom({ kind: 'next_day' }, new Date('2026-09-21T16:00:00Z')).toISOString()).toBe(
      '2026-09-22T15:00:00.000Z',
    );
  });

  it('after_ms 는 그만큼 뒤, 힌트가 없으면 기본 백오프', () => {
    const from = new Date('2026-09-21T00:00:00Z');
    expect(nextAttemptFrom({ kind: 'after_ms', ms: 60_000 }, from).toISOString()).toBe('2026-09-21T00:01:00.000Z');
    expect(nextAttemptFrom(undefined, from).getTime()).toBe(from.getTime() + WAYBILL.TRANSIENT_DEFAULT_BACKOFF_MS);
  });
});
