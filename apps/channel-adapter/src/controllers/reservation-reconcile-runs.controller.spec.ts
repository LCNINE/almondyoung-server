import { ValidationPipe } from '@nestjs/common';
import { ConflictError, NotFoundError } from '@app/shared';
import { ReservationReconcileRunsService } from '../services/reservation-projection/reservation-reconcile-runs.service';
import type { ReconcileRunRow } from '../services/reservation-projection/reservation-reconcile-run.repository';
import { CloseReconcileRunDto, ReservationReconcileRunsController } from './reservation-reconcile-runs.controller';

const row = (over: Partial<ReconcileRunRow> = {}): ReconcileRunRow =>
  ({ id: 'r1', status: 'halted', closedAt: null, ...over }) as ReconcileRunRow;

const setup = (found: ReconcileRunRow | null) => {
  const runs = {
    findById: jest.fn().mockResolvedValue(found),
    listOpenHalted: jest.fn().mockResolvedValue([]),
    latest: jest.fn().mockResolvedValue(null),
    closeOpenHalted: jest.fn().mockResolvedValue(true),
  };
  const reconcile = { run: jest.fn().mockResolvedValue({ id: 'new', status: 'applied' }) };
  const service = new ReservationReconcileRunsService(runs as never, reconcile as never);
  return { runs, reconcile, controller: new ReservationReconcileRunsController(service) };
};
const user = { id: 'u1' };

describe('ReservationReconcileRunsController', () => {
  it('apply 는 limit null 과 처리자로 run 을 부르고 원래 회차를 forced 로 닫는다', async () => {
    const { controller, reconcile, runs } = setup(row());
    const res = await controller.apply('r1', user);
    expect(reconcile.run).toHaveBeenCalledWith({ limit: null, forcedBy: 'u1' });
    expect(runs.closeOpenHalted).toHaveBeenCalledWith('r1', 'u1', 'forced');
    expect(res).toEqual({ data: { id: 'new', status: 'applied' } });
  });

  it('닫힌 회차 apply 는 409, run 은 부르지 않는다', async () => {
    const { controller, reconcile } = setup(row({ closedAt: new Date() }));
    await expect(controller.apply('r1', user)).rejects.toBeInstanceOf(ConflictError);
    expect(reconcile.run).not.toHaveBeenCalled();
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
