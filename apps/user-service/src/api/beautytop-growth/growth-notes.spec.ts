import { DbService } from '@app/db';
import { BadRequestError } from '@app/shared';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { RecordGrowthNoteDto } from './dto/growth-note.dto';
import { GrowthNotesManager } from './growth-notes.manager';
import { GrowthNotesRepository } from './growth-notes.repository';

const target = { shopKind: 'SHOP', shopId: 42 } as const;
const record = { ...target, action: 'SHOWCASE', memo: 'A new example' } as const;

describe('BeautyTop growth note permissions', () => {
  const repository = { isMyShop: jest.fn(), record: jest.fn(), remove: jest.fn() };
  const run = jest.fn(async (work: (tx: unknown) => Promise<void>) => work({}));
  let manager: GrowthNotesManager;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        GrowthNotesManager,
        { provide: GrowthNotesRepository, useValue: repository },
        { provide: DbService, useValue: { run } },
      ],
    }).compile();
    manager = module.get(GrowthNotesManager);
  });

  it('rejects another shop before inserting', async () => {
    repository.isMyShop.mockResolvedValue(false);
    await expect(manager.record('owner', record)).rejects.toBeInstanceOf(BadRequestError);
    expect(repository.record).not.toHaveBeenCalled();
  });

  it('checks ownership and inserts in the same transaction', async () => {
    repository.isMyShop.mockResolvedValue(true);
    await manager.record('owner', record);
    expect(run).toHaveBeenCalledTimes(1);
    expect(repository.isMyShop).toHaveBeenCalledWith('owner', record, expect.any(Object));
    expect(repository.record.mock.calls[0][2]).toBe(repository.isMyShop.mock.calls[0][2]);
  });

  it('rejects oversized notes before opening a transaction', async () => {
    await expect(manager.record('owner', { ...record, memo: 'x'.repeat(241) })).rejects.toBeInstanceOf(BadRequestError);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('BeautyTop growth note query isolation', () => {
  const dialect = new PgDialect();
  it('scopes reads and deletes to the authenticated owner and requested shop', async () => {
    const limit = jest.fn().mockResolvedValue([]);
    const where = jest.fn((condition: SQL) => ({ orderBy: jest.fn(() => ({ limit })) }));
    const deleteWhere = jest.fn((condition: SQL) => Promise.resolve());
    const module = await Test.createTestingModule({
      providers: [
        GrowthNotesRepository,
        {
          provide: DbService,
          useValue: {
            db: {
              select: () => ({ from: () => ({ where }) }),
              delete: () => ({ where: deleteWhere }),
            },
          },
        },
      ],
    }).compile();
    const repository = module.get(GrowthNotesRepository);
    await repository.list('owner', target);
    const readQuery = dialect.sqlToQuery(where.mock.calls[0][0]);
    expect(readQuery.params).toEqual(['owner', 'SHOP', 42]);
    expect(limit).toHaveBeenCalledWith(30);
    await repository.remove('owner', target, 'note-id');
    expect(dialect.sqlToQuery(deleteWhere.mock.calls[0][0]).params).toEqual(['note-id', 'owner', 'SHOP', 42]);
  });
});

describe('BeautyTop growth note input validation', () => {
  it('accepts query-string IDs and supported actions', async () => {
    expect(await validate(plainToInstance(RecordGrowthNoteDto, { ...record, shopId: '42' }))).toEqual([]);
  });
  it.each([
    { ...record, action: 'REVENUE_GUARANTEE' },
    { ...record, shopKind: 'OTHER' },
    { ...record, shopId: 0 },
    { ...record, shopId: 2.5 },
    { ...record, memo: 'x'.repeat(241) },
  ])('rejects unsupported or malformed input %#', async (input) => {
    expect((await validate(plainToInstance(RecordGrowthNoteDto, input))).length).toBeGreaterThan(0);
  });
});
