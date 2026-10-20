import { Test } from '@nestjs/testing';
import { IamAuditCreator } from './iam-audit.creator';
import { IamAuditRepository } from './iam-audit.repository';

describe('IamAuditCreator', () => {
  const repository = { insert: jest.fn() };
  const tx = { insert: jest.fn() };
  const actor = { userId: 'u-1', loginId: 'boss', roles: ['master'], userAgent: 'ua', requestId: 'req-1', ip: '203.0.113.7' };
  let creator: IamAuditCreator;

  beforeEach(async () => {
    repository.insert.mockReset();
    const module = await Test.createTestingModule({
      providers: [IamAuditCreator, { provide: IamAuditRepository, useValue: repository }],
    }).compile();
    creator = module.get(IamAuditCreator);
  });

  it('writes one row in the caller transaction with who, what and the request', async () => {
    await creator.record(tx, actor, {
      action: 'role.update',
      targetType: 'role',
      targetId: 'r-1',
      targetLabel: '인턴',
      before: { displayName: '인턴' },
      after: { displayName: '인턴(여름)' },
    });
    expect(repository.insert).toHaveBeenCalledWith(
      {
        actorUserId: 'u-1',
        actorLoginId: 'boss',
        action: 'role.update',
        targetType: 'role',
        targetId: 'r-1',
        targetLabel: '인턴',
        before: { displayName: '인턴' },
        after: { displayName: '인턴(여름)' },
        ip: '203.0.113.7',
        userAgent: 'ua',
        requestId: 'req-1',
      },
      tx,
    );
  });

  it('cuts a long target name to the column size', async () => {
    await creator.record(tx, actor, {
      action: 'role.create',
      targetType: 'role',
      targetId: 'r-1',
      targetLabel: '가'.repeat(150),
      before: null,
      after: {},
    });
    expect(repository.insert.mock.calls[0][0].targetLabel).toHaveLength(100);
  });

  it('fails the change when the history row cannot be written', async () => {
    repository.insert.mockRejectedValueOnce(new Error('db down'));
    await expect(
      creator.record(tx, actor, {
        action: 'role.delete',
        targetType: 'role',
        targetId: 'r-1',
        targetLabel: 'x',
        before: {},
        after: null,
      }),
    ).rejects.toThrow('db down');
  });
});
