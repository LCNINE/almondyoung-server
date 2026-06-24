import { csCaseEvents, csCases } from '../schema/customer-service.schema';
import { makeFakeDb } from '../__fixtures__/fake-db';
import { CsCasesService } from './cs-cases.service';

describe('CsCasesService.create', () => {
  it('creates a ticket with defaults and stamps the operator', async () => {
    const { db, state } = makeFakeDb();
    const service = new CsCasesService(db as any);

    const created = await service.create(
      { subject: '상품 불량 문의', description: '카톡 내용 요약', externalThreadRef: '카톡상담방 A' },
      'operator-1',
    );

    expect(state.get(csCases)).toHaveLength(1);
    expect(created).toMatchObject({
      subject: '상품 불량 문의',
      status: 'open',
      priority: 'normal',
      sourceChannel: 'kakao',
      externalThreadRef: '카톡상담방 A',
      createdBy: 'operator-1',
      labelIds: [],
      timeline: [],
    });
  });
});

describe('CsCasesService.updateStatus', () => {
  it('closes a ticket, sets closedAt, and records a status_changed event', async () => {
    const { db, state } = makeFakeDb();
    const service = new CsCasesService(db as any);
    const created = await service.create({ subject: 'x' }, 'op-1');

    const updated = await service.updateStatus(created.id, 'closed', 'op-2');

    expect(updated.status).toBe('closed');
    expect(updated.closedAt).not.toBeNull();
    const events = state.get(csCaseEvents);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'status_changed',
      actorId: 'op-2',
      payload: { from: 'open', to: 'closed' },
    });
  });

  it('reopening clears closedAt', async () => {
    const { db } = makeFakeDb();
    const service = new CsCasesService(db as any);
    const created = await service.create({ subject: 'x' }, 'op-1');
    await service.updateStatus(created.id, 'closed', 'op-1');

    const reopened = await service.updateStatus(created.id, 'open', 'op-1');

    expect(reopened.status).toBe('open');
    expect(reopened.closedAt).toBeNull();
  });

  it('is a no-op event when status is unchanged', async () => {
    const { db, state } = makeFakeDb();
    const service = new CsCasesService(db as any);
    const created = await service.create({ subject: 'x' }, 'op-1');

    await service.updateStatus(created.id, 'open', 'op-1');

    expect(state.get(csCaseEvents)).toHaveLength(0);
  });
});
