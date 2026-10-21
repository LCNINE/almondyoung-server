import { PermissionCache } from '@app/authorization';
import { BadRequestError, ForbiddenError } from '@app/shared';
import { DbService } from '@app/db';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { decodeAuditCursor } from '../audit/iam-audit.reader';
import { IamAuditCreator } from '../audit/iam-audit.creator';
import type { IamActor } from '../iam-actor';
import { PiiAccessConsumer } from './pii-access.consumer';
import { PiiAccessCreator } from './pii-access.creator';
import { PiiAccessManager } from './pii-access.manager';
import { PiiAccessReader } from './pii-access.reader';
import { PiiAccessRepository } from './pii-access.repository';
import { PiiAccessRetentionCron } from './pii-access-retention.cron';

const actor: IamActor = {
  userId: '0192f3a4-0000-7000-8000-000000000001',
  loginId: 'master1',
  roles: ['master'],
  userAgent: 'jest',
  requestId: 'req-1',
  ip: '203.0.113.7',
};

const record = {
  eventId: '0192f3a4-0000-4000-8000-0000000000aa',
  actorUserId: '0192f3a4-0000-7000-8000-000000000002',
  actorLoginId: 'kim',
  claimedIp: '203.0.113.9',
  peerIp: '10.0.0.5',
  forwardedFor: null,
  userAgent: 'Mozilla',
  requestId: 'r',
  sourceService: 'core' as const,
  method: 'GET',
  route: '/sales-orders/:id',
  action: 'view' as const,
  subjects: [{ type: 'sales_order' as const, id: 'so-1' }],
  subjectCount: 1,
  kinds: ['name' as const],
  queryKeys: ['limit'],
  reason: null,
  occurredAt: new Date('2026-10-19T05:00:00.000Z'),
};

describe('PiiAccessCreator', () => {
  it('maps a record to a row and keeps the subjects as identifiers only', async () => {
    const repository = { insert: jest.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      providers: [PiiAccessCreator, { provide: PiiAccessRepository, useValue: repository }],
    }).compile();
    await module.get(PiiAccessCreator).record(record);
    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: record.eventId,
        actorUserId: record.actorUserId,
        subjects: [{ type: 'sales_order', id: 'so-1' }],
        subjectCount: 1,
        kinds: ['name'],
        queryKeys: ['limit'],
        occurredAt: record.occurredAt,
      }),
    );
  });
});

describe('PiiAccessReader', () => {
  const repository = { page: jest.fn(), summary: jest.fn(), pageReviews: jest.fn() };
  let reader: PiiAccessReader;

  beforeEach(async () => {
    repository.page.mockReset();
    const module = await Test.createTestingModule({
      providers: [PiiAccessReader, { provide: PiiAccessRepository, useValue: repository }],
    }).compile();
    reader = module.get(PiiAccessReader);
  });

  it('pages by occurred_at and id cursor without skipping rows of the same millisecond', async () => {
    const at = new Date('2026-10-19T00:00:00.000Z');
    repository.page.mockResolvedValue([
      { id: 'b', occurredAt: at },
      { id: 'a', occurredAt: at },
      { id: 'z', occurredAt: at },
    ]);
    const page = await reader.page({ limit: 2 });
    expect(repository.page.mock.calls[0][1]).toBe(3);
    expect(decodeAuditCursor(page.nextCursor ?? '')).toEqual({ occurredAt: at, id: 'a' });
  });

  it('passes the subject filter as a type and id pair', async () => {
    repository.page.mockResolvedValue([]);
    await reader.page({ subjectType: 'user', subjectId: 'u-1' });
    expect(repository.page.mock.calls[0][0]).toMatchObject({ subject: { type: 'user', id: 'u-1' } });
  });

  it('refuses a subject id without its type', async () => {
    await expect(reader.page({ subjectId: 'u-1' })).rejects.toBeInstanceOf(BadRequestError);
  });
});

describe('PiiAccessManager', () => {
  const repository = { insertReview: jest.fn().mockResolvedValue({ id: 'rev-1' }) };
  const creator = { record: jest.fn().mockResolvedValue(undefined) };
  let held: ReadonlySet<string> | null = new Set(['customer.pii.read']);
  const cache = { permissionsFor: jest.fn(() => held) };
  const reader = { page: jest.fn().mockResolvedValue({ items: [], nextCursor: null }) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const tx = { marker: 'tx' };
  const dbService = { run: jest.fn((cb: (t: object) => Promise<unknown>) => cb(tx)) };
  let manager: PiiAccessManager;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        PiiAccessManager,
        { provide: PiiAccessRepository, useValue: repository },
        { provide: PiiAccessReader, useValue: reader },
        { provide: IamAuditCreator, useValue: audit },
        { provide: DbService, useValue: dbService },
        { provide: PiiAccessCreator, useValue: creator },
        { provide: PermissionCache, useValue: cache },
      ],
    }).compile();
    manager = module.get(PiiAccessManager);
    held = new Set(['customer.pii.read']);
  });

  it('records an own access when the caller holds customer.pii.read', async () => {
    await manager.recordOwn(actor, record);
    expect(creator.record).toHaveBeenCalledWith(record);
  });

  it('refuses an own record from a caller without customer.pii.read', async () => {
    held = new Set(['order.order.read']);
    await expect(manager.recordOwn(actor, record)).rejects.toBeInstanceOf(ForbiddenError);
    expect(creator.record).not.toHaveBeenCalled();
  });

  it('refuses an own record while the permission snapshot is missing', async () => {
    held = null;
    await expect(manager.recordOwn(actor, record)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('reads the page and records the audit row in the same transaction', async () => {
    await manager.viewLogs(actor, { actorUserId: record.actorUserId });
    expect(reader.page).toHaveBeenCalledWith({ actorUserId: record.actorUserId }, tx);
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      actor,
      expect.objectContaining({ action: 'pii_access_log.view', targetType: 'pii_access_log', targetId: actor.userId }),
    );
  });

  it('rejects a review range that ends before it starts', async () => {
    await expect(
      manager.createReview(actor, { period: '2026-10', rangeFrom: '2026-10-31T00:00:00Z', rangeTo: '2026-10-01T00:00:00Z' }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('stores who reviewed which range', async () => {
    await manager.createReview(actor, {
      period: '2026-10',
      rangeFrom: '2026-10-01T00:00:00Z',
      rangeTo: '2026-11-01T00:00:00Z',
      note: '이상 없음',
    });
    expect(repository.insertReview).toHaveBeenCalledWith(
      expect.objectContaining({ period: '2026-10', reviewedBy: actor.userId, reviewedByLoginId: 'master1', note: '이상 없음' }),
    );
  });
});

describe('PiiAccessConsumer', () => {
  it('stores a PiiAccessed event with its time parsed', async () => {
    const creator = { record: jest.fn().mockResolvedValue(undefined) };
    const consumer = new PiiAccessConsumer(creator);
    await consumer.onPiiAccessed({ ...record, occurredAt: '2026-10-19T05:00:00.000Z' });
    expect(creator.record).toHaveBeenCalledWith(expect.objectContaining({ eventId: record.eventId, occurredAt: record.occurredAt }));
  });

  it('rejects a payload that breaks the contract so it goes to the dead letter path', async () => {
    const consumer = new PiiAccessConsumer({ record: jest.fn() });
    await expect(consumer.onPiiAccessed({ ...record, occurredAt: 'yesterday' })).rejects.toThrow();
  });
});

describe('PiiAccessRetentionCron', () => {
  it('deletes rows older than the retention days in batches', async () => {
    const deleteBefore = jest.fn().mockResolvedValueOnce(10_000).mockResolvedValueOnce(3);
    const config = { get: jest.fn((key: string) => (key === 'PII_ACCESS_LOG_RETENTION_DAYS' ? '30' : undefined)) };
    const module = await Test.createTestingModule({
      providers: [
        PiiAccessRetentionCron,
        { provide: PiiAccessRepository, useValue: { deleteBefore } },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    const now = new Date('2026-10-19T00:00:00.000Z');
    const deleted = await module.get(PiiAccessRetentionCron).purge(now);
    expect(deleted).toBe(10_003);
    expect(deleteBefore).toHaveBeenCalledTimes(2);
    expect(deleteBefore.mock.calls[0][0]).toEqual(new Date('2026-09-19T00:00:00.000Z'));
  });

  it('falls back to two years when the setting is missing or invalid', async () => {
    const deleteBefore = jest.fn().mockResolvedValue(0);
    const module = await Test.createTestingModule({
      providers: [
        PiiAccessRetentionCron,
        { provide: PiiAccessRepository, useValue: { deleteBefore } },
        { provide: ConfigService, useValue: { get: () => 'abc' } },
      ],
    }).compile();
    await module.get(PiiAccessRetentionCron).purge(new Date('2026-10-19T00:00:00.000Z'));
    expect(deleteBefore.mock.calls[0][0]).toEqual(new Date('2024-10-19T00:00:00.000Z'));
  });
});
