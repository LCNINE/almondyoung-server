import {
  csCaseCommentAttachments,
  csCaseCommentMentions,
  csCaseComments,
  csCaseEvents,
  csCaseLabels,
  csCases,
} from '../schema/customer-service.schema';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { makeFakeDb } from '../__fixtures__/fake-db';
import { CsCasesService } from './cs-cases.service';

type TimelineItem = {
  kind: string;
  mentions?: string[];
  attachmentFileIds?: string[];
};

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

describe('CsCasesService.assign', () => {
  it('assigns an owner and records an assigned event', async () => {
    const { db, state } = makeFakeDb();
    const service = new CsCasesService(db as any);
    const created = await service.create({ subject: 'x' }, 'op-1');

    const updated = await service.assign(created.id, 'agent-9', 'op-1');

    expect(updated.assignedTo).toBe('agent-9');
    expect(state.get(csCaseEvents)[0]).toMatchObject({
      type: 'assigned',
      payload: { from: null, to: 'agent-9' },
    });
  });

  it('unassigns and records an unassigned event', async () => {
    const { db, state } = makeFakeDb();
    const service = new CsCasesService(db as any);
    const created = await service.create({ subject: 'x', assignedTo: 'agent-9' } as any, 'op-1');

    const updated = await service.assign(created.id, null, 'op-1');

    expect(updated.assignedTo).toBeNull();
    expect(state.get(csCaseEvents)[0]).toMatchObject({
      type: 'unassigned',
      payload: { from: 'agent-9' },
    });
  });

  it('rejects assigning to the current owner', async () => {
    const { db } = makeFakeDb();
    const service = new CsCasesService(db as any);
    const created = await service.create({ subject: 'x', assignedTo: 'agent-9' } as any, 'op-1');

    await expect(service.assign(created.id, 'agent-9', 'op-1')).rejects.toThrow('already assigned');
  });
});

describe('CsCasesService.getOne timeline', () => {
  it('merges comments, events, and business links ordered by occurredAt, with labelIds', async () => {
    const seed = new Map<unknown, any[]>();
    const caseId = 'aaaaaaaa-0000-4000-8000-000000000001';
    seed.set(csCases, [
      {
        id: caseId,
        status: 'open',
        priority: 'normal',
        subject: 'x',
        metadata: {},
        createdAt: new Date('2026-06-20T00:00:00Z'),
        updatedAt: new Date('2026-06-20T00:00:00Z'),
      },
    ]);
    seed.set(csCaseComments, [
      {
        id: 'c1',
        csCaseId: caseId,
        authorId: 'op-1',
        body: '카톡으로 이렇게 답함',
        editedAt: null,
        deletedAt: null,
        createdAt: new Date('2026-06-20T00:02:00Z'),
      },
    ]);
    seed.set(csCaseCommentMentions, [{ id: 'm1', commentId: 'c1', mentionedUserId: 'agent-2' }]);
    seed.set(csCaseCommentAttachments, [{ id: 'a1', commentId: 'c1', csCaseId: caseId, fileId: 'file_123' }]);
    seed.set(csCaseEvents, [
      {
        id: 'e1',
        csCaseId: caseId,
        type: 'status_changed',
        actorId: 'op-1',
        payload: { from: 'open', to: 'pending' },
        occurredAt: new Date('2026-06-20T00:01:00Z'),
      },
    ]);
    seed.set(wmsTables.businessLinks, [
      {
        id: 'l1',
        sourceType: 'cs_case',
        sourceId: caseId,
        sourceExternalRef: null,
        targetType: 'sales_order',
        targetId: 'so-1',
        targetExternalRef: null,
        relationName: 'opened_for_sales_order',
        metadata: {},
        occurredAt: new Date('2026-06-20T00:03:00Z'),
        createdAt: new Date('2026-06-20T00:03:00Z'),
      },
    ]);
    seed.set(csCaseLabels, [{ id: 'cl1', csCaseId: caseId, labelId: 'label-1' }]);

    const { db } = makeFakeDb(seed);
    const service = new CsCasesService(db as any);

    const result = await service.getOne(caseId);

    expect(result.labelIds).toEqual(['label-1']);
    const timeline = result.timeline as TimelineItem[];
    expect(timeline.map((t) => t.kind)).toEqual(['event', 'comment', 'business_link']);
    const comment = timeline.find((t) => t.kind === 'comment');
    expect(comment?.mentions).toEqual(['agent-2']);
    expect(comment?.attachmentFileIds).toEqual(['file_123']);
  });
});
