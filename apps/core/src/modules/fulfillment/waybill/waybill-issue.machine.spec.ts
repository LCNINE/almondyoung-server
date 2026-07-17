import {
  CarrierError,
  type AllocateResult,
  type CarrierGateway,
  type RegisterOutcome,
  type WaybillRequest,
} from './carrier/carrier-gateway.interface';
import { CarrierGatewayRegistry } from './carrier/carrier-gateway.registry';
import { WaybillIssueMachine } from './waybill-issue.machine';
import { WAYBILL } from './waybill.constants';
import type { WaybillRow } from './waybill.types';
import type { DbService } from '@app/db';
import type { WaybillRepository } from './waybill.repository';

const REQ = {} as WaybillRequest;
const runNoTx = { run: <T>(fn: (t: unknown) => Promise<T>) => fn({}) } as unknown as DbService<never>;

// 인메모리 fake repo: 단일 행 상태를 들고 CAS 시맨틱을 재현.
function fakeRepo(initial: Partial<WaybillRow>): { repo: WaybillRepository; row: WaybillRow } {
  const row = { id: 'w1', status: 'pending', attempts: 0, trackingNo: null, ...initial } as WaybillRow;
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
    casToAbandoned: (_t: unknown, _id: string, from: string) => {
      if (row.status !== from) return Promise.resolve(false);
      Object.assign(row, { status: 'abandoned' });
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

  it('allocate definitive_rejection → failed', async () => {
    const { repo, row } = fakeRepo({ carrier: 'HANJIN' });
    const machine = new WaybillIssueMachine(
      repo,
      gatewayOf({
        allocate: () => {
          throw new CarrierError('nope', 'definitive_rejection', { code: 'ERROR-05' });
        },
      }),
      runNoTx,
    );
    const out = await machine.drive(row.id, REQ);
    expect(out.status).toBe('failed');
    expect(out.lastError).toContain('ERROR-05');
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
