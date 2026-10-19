import { BadRequestError } from '@app/shared';
import { Test } from '@nestjs/testing';
import { decodeAuditCursor, encodeAuditCursor, IamAuditReader } from './iam-audit.reader';
import { IamAuditRepository } from './iam-audit.repository';

describe('IamAuditReader', () => {
  const repository = { page: jest.fn() };
  let reader: IamAuditReader;

  beforeEach(async () => {
    repository.page.mockReset();
    const module = await Test.createTestingModule({
      providers: [IamAuditReader, { provide: IamAuditRepository, useValue: repository }],
    }).compile();
    reader = module.get(IamAuditReader);
  });

  const row = (id: string, at: string) => ({ id, occurredAt: new Date(at) });

  it('asks for one more row than the page and returns a cursor only when there is another page', async () => {
    repository.page.mockResolvedValue([
      row('b', '2026-10-13T01:00:00Z'),
      row('a', '2026-10-13T00:00:00Z'),
      row('z', '2026-10-12T00:00:00Z'),
    ]);
    const result = await reader.page({ limit: 2 });
    expect(repository.page.mock.calls[0][1]).toBe(3);
    expect(result.items.map((i) => i.id)).toEqual(['b', 'a']);
    expect(decodeAuditCursor(result.nextCursor ?? '')).toEqual({
      occurredAt: new Date('2026-10-13T00:00:00Z'),
      id: 'a',
    });
  });

  it('has no cursor on the last page', async () => {
    repository.page.mockResolvedValue([row('a', '2026-10-13T00:00:00Z')]);
    expect((await reader.page({ limit: 2 })).nextCursor).toBeNull();
  });

  it('passes the decoded cursor and filters through', async () => {
    repository.page.mockResolvedValue([]);
    const cursor = encodeAuditCursor({ occurredAt: new Date('2026-10-13T00:00:00Z'), id: 'a' });
    await reader.page({ cursor, roleId: 'r-1', from: '2026-10-01T00:00:00Z' });
    expect(repository.page).toHaveBeenCalledWith(
      expect.objectContaining({
        roleId: 'r-1',
        from: new Date('2026-10-01T00:00:00Z'),
        before: { occurredAt: new Date('2026-10-13T00:00:00Z'), id: 'a' },
      }),
      51,
    );
  });

  it('round-trips a cursor and rejects a broken one with a 400', () => {
    const cursor = encodeAuditCursor({ occurredAt: new Date('2026-10-13T00:00:00.123Z'), id: 'a' });
    expect(decodeAuditCursor(cursor)).toEqual({ occurredAt: new Date('2026-10-13T00:00:00.123Z'), id: 'a' });
    expect(() => decodeAuditCursor('###')).toThrow(BadRequestError);
  });
});
