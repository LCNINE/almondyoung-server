import { ValidationPipe } from '@nestjs/common';
import { ConflictError, NotFoundError } from '@app/shared';
import { ReservationReconcileRunsService } from '../services/reservation-projection/reservation-reconcile-runs.service';
import type { ReconcileRunRow } from '../services/reservation-projection/reservation-reconcile-run.repository';
import { CloseReconcileRunDto, ReservationReconcileRunsController } from './reservation-reconcile-runs.controller';

const row = (over: Partial<ReconcileRunRow> = {}): ReconcileRunRow =>
  ({ id: 'r1', status: 'halted', closedAt: null, ...over }) as ReconcileRunRow;

const setup = (found: ReconcileRunRow | null) => {
  const started = row({ id: 'new', status: 'running' });
  const runs = {
    findById: jest.fn(async (id: string) => (id === 'new' ? started : found)),
    listOpenHalted: jest.fn().mockResolvedValue([]),
    latest: jest.fn().mockResolvedValue(null),
    closeOpenHalted: jest.fn().mockResolvedValue(true),
  };
  let finish: (record: { id: string; status: string; error?: string } | null) => void = () => undefined;
  const done = new Promise<{ id: string; status: string; error?: string } | null>((resolve) => {
    finish = resolve;
  });
  const reconcile = { startForced: jest.fn().mockResolvedValue({ kind: 'started', id: 'new', done }) };
  const service = new ReservationReconcileRunsService(runs as never, reconcile as never);
  return {
    runs,
    reconcile,
    started,
    /** 뒤에서 도는 강제 회차를 끝낸다 — 그 뒤의 then 이 돌 때까지 기다린다. */
    finishBackground: async (record: { id: string; status: string; error?: string } | null) => {
      finish(record);
      await new Promise((resolve) => setImmediate(resolve));
    },
    controller: new ReservationReconcileRunsController(service),
  };
};
const user = { id: 'u1' };

describe('ReservationReconcileRunsController', () => {
  it('apply 는 202 — 강제 회차를 시작만 하고 그 running 행을 바로 돌려준다', async () => {
    const { controller, reconcile, runs, started } = setup(row());
    const res = await controller.apply('r1', user);
    expect(reconcile.startForced).toHaveBeenCalledWith('u1');
    expect(res).toEqual({ data: started });
    expect(runs.closeOpenHalted).not.toHaveBeenCalled(); // 아직 도는 중
    expect(Reflect.getMetadata('__httpCode__', ReservationReconcileRunsController.prototype.apply)).toBe(202);
  });

  it('뒤의 강제 회차가 applied 로 끝나면 원래 회차를 forced 로 닫는다', async () => {
    const { controller, runs, finishBackground } = setup(row());
    await controller.apply('r1', user);
    await finishBackground({ id: 'new', status: 'applied' });
    expect(runs.closeOpenHalted).toHaveBeenCalledWith('r1', 'u1', 'forced');
  });

  it.each([['skipped'], ['halted'], [null]])('뒤의 강제 회차가 %s 면 원래 회차를 열어 둔다', async (status) => {
    const { controller, runs, finishBackground } = setup(row());
    await controller.apply('r1', user);
    await finishBackground(status === null ? null : { id: 'new', status, error: 'boom' });
    expect(runs.closeOpenHalted).not.toHaveBeenCalled();
  });

  it.each([
    ['busy', '도는 중'],
    ['not_ready', '전환 시각'],
  ])('강제 회차를 시작할 수 없으면(%s) 409', async (kind, text) => {
    const { controller, reconcile } = setup(row());
    reconcile.startForced.mockResolvedValue({ kind });
    await expect(controller.apply('r1', user)).rejects.toThrow(text);
    await expect(controller.apply('r1', user)).rejects.toBeInstanceOf(ConflictError);
  });

  it('닫힌 회차 apply 는 409, 강제 회차는 시작하지 않는다', async () => {
    const { controller, reconcile } = setup(row({ closedAt: new Date() }));
    await expect(controller.apply('r1', user)).rejects.toBeInstanceOf(ConflictError);
    expect(reconcile.startForced).not.toHaveBeenCalled();
  });

  it('halted 가 아니면 apply 409', async () => {
    const { controller } = setup(row({ status: 'applied' }));
    await expect(controller.apply('r1', user)).rejects.toBeInstanceOf(ConflictError);
  });

  it('없는 id 는 404', async () => {
    const { controller } = setup(null);
    await expect(controller.apply('r1', user)).rejects.toBeInstanceOf(NotFoundError);
    await expect(controller.close('r1', { reason: 'x' }, user)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('close 는 사유로 닫고, 동시에 먼저 닫혔으면 409', async () => {
    const { controller, runs } = setup(row());
    await controller.close('r1', { reason: '확인함' }, user);
    expect(runs.closeOpenHalted).toHaveBeenCalledWith('r1', 'u1', '확인함');
    runs.closeOpenHalted.mockResolvedValue(false);
    await expect(controller.close('r1', { reason: 'x' }, user)).rejects.toBeInstanceOf(ConflictError);
  });

  it('닫힌 회차 close 는 409', async () => {
    const { controller } = setup(row({ closedAt: new Date() }));
    await expect(controller.close('r1', { reason: 'x' }, user)).rejects.toBeInstanceOf(ConflictError);
  });

  it('목록은 open 과 latest 를 돌려준다', async () => {
    const { controller } = setup(null);
    expect(await controller.overview()).toEqual({ data: { open: [], latest: null } });
  });

  describe('CloseReconcileRunDto', () => {
    const pipe = new ValidationPipe({ transform: true });
    const check = (reason: unknown) => pipe.transform({ reason }, { type: 'body', metatype: CloseReconcileRunDto });

    it.each(['', '   ', 'a'.repeat(201)])('잘못된 사유 %#는 400', async (reason) => {
      await expect(check(reason)).rejects.toMatchObject({ status: 400 });
    });
    it('앞뒤 공백을 잘라 받는다', async () => {
      await expect(check('  사유 ')).resolves.toMatchObject({ reason: '사유' });
    });
  });
});
