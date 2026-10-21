import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { IamActor } from '../iam-actor';
import { PiiAccessRecordController } from './pii-access-record.controller';
import { PiiAccessService } from './pii-access.service';

const actor: IamActor = {
  userId: '0192f3a4-0000-7000-8000-000000000003',
  loginId: 'admin1',
  roles: ['admin'],
  userAgent: 'Mozilla',
  requestId: 'req-9',
  ip: '203.0.113.7',
};

describe('PiiAccessRecordController', () => {
  const service = { record: jest.fn().mockResolvedValue(undefined), recordOwn: jest.fn().mockResolvedValue(undefined) };
  let controller: PiiAccessRecordController;

  beforeEach(async () => {
    service.record.mockClear();
    service.recordOwn.mockClear();
    const module = await Test.createTestingModule({
      controllers: [PiiAccessRecordController],
      providers: [
        { provide: PiiAccessService, useValue: service },
        { provide: ConfigService, useValue: { get: () => 'k' } },
      ],
    }).compile();
    controller = module.get(PiiAccessRecordController);
  });

  it('takes the actor and the time from the server, not the body', async () => {
    const body = {
      eventId: '0192f3a4-0000-4000-8000-0000000000bb',
      sourceService: 'admin-web',
      method: 'GET',
      route: 'admin/orders/:id',
      action: 'view' as const,
      subjects: [{ type: 'medusa_order', id: 'order_1' }],
      subjectCount: 1,
      kinds: ['email'],
      queryKeys: ['fields'],
      reason: null,
      occurredAt: '2026-10-19T05:00:00.000Z',
      claimedIp: '198.51.100.4',
      forwardedFor: '198.51.100.4',
      peerIp: null,
      actorUserId: 'someone-else',
    };
    const before = Date.now();
    await controller.recordOwn(actor, body);
    const recorded = service.recordOwn.mock.calls[0][1].occurredAt as Date;
    expect(recorded.getTime()).toBeGreaterThanOrEqual(before);
    expect(recorded.getTime()).toBeLessThanOrEqual(Date.now());
    expect(service.recordOwn).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        actorUserId: actor.userId,
        actorLoginId: 'admin1',
        userAgent: 'Mozilla',
        requestId: 'req-9',
        sourceService: 'admin-web',
        claimedIp: '198.51.100.4',
      }),
    );
  });

  it('records what an internal caller sends, actor included', async () => {
    await controller.recordInternal({
      eventId: '0192f3a4-0000-4000-8000-0000000000cc',
      actorUserId: '0192f3a4-0000-7000-8000-000000000004',
      actorLoginId: 'cs1',
      claimedIp: null,
      peerIp: '10.0.0.8',
      forwardedFor: null,
      userAgent: null,
      requestId: null,
      sourceService: 'notification',
      method: 'GET',
      route: '/notifications/:id',
      action: 'view',
      subjects: [{ type: 'notification', id: 'n-1' }],
      subjectCount: 1,
      kinds: ['phone'],
      queryKeys: [],
      reason: null,
      occurredAt: '2026-10-19T05:00:00.000Z',
    });
    expect(service.record).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: '0192f3a4-0000-7000-8000-000000000004', sourceService: 'notification' }),
    );
  });
});
