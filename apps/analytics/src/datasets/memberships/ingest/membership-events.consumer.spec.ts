import { Logger } from '@nestjs/common';
import type { DomainEvent } from '@packages/event-contracts/types';
import type { MembershipStatusChangedPayload } from '@packages/event-contracts/streams/membership.stream';
import { MembershipEventsConsumer } from './membership-events.consumer';
import type { MembershipFactResult } from '../facts/membership-types';

let logSpy: jest.SpyInstance;
let debugSpy: jest.SpyInstance;

beforeEach(() => {
  // Keep jest output pristine — onMembershipStatusChanged logs at log/debug level on
  // every call.
  logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
  debugSpy.mockRestore();
});

const payload: MembershipStatusChangedPayload = {
  userId: 'user-1',
  status: 'ACTIVE',
  occurredAt: '2026-07-01T00:00:00.000Z',
  tierId: 'tier-1',
};

const envelope: DomainEvent<MembershipStatusChangedPayload> = {
  messageId: '01J00000000000000000000050',
  messageType: 'MembershipStatusChanged',
  messageVersion: 1,
  messageKind: 'event',
  correlationId: '01J00000000000000000000051',
  timestamp: '2026-07-01T00:00:00.000Z',
  source: { service: 'membership', aggregateType: 'Membership', aggregateId: payload.userId },
  payload,
};

describe('MembershipEventsConsumer.onMembershipStatusChanged', () => {
  function makeConsumer(result: MembershipFactResult) {
    const tx = { id: 'analytics-tx' };
    const run = jest.fn((fn: (executor: unknown) => unknown) => fn(tx));
    const dbService = { run };
    const membershipFactsService = { recordStatusChanged: jest.fn().mockResolvedValue(result) };
    const membershipDimensionsService = { applyStatusChanged: jest.fn().mockResolvedValue(undefined) };
    const consumer = new MembershipEventsConsumer(
      dbService as never,
      membershipFactsService as never,
      membershipDimensionsService as never,
    );
    return { consumer, tx, membershipFactsService, membershipDimensionsService };
  }

  it('claimed=false 이면 dimension 쓰기를 건너뛴다 (중복 메시지)', async () => {
    const { consumer, membershipFactsService, membershipDimensionsService } = makeConsumer({
      claimed: false,
      userId: 'user-1',
      status: 'ACTIVE',
      tierId: 'tier-1',
      occurredAt: new Date('2026-07-01T00:00:00.000Z'),
    });

    await consumer.onMembershipStatusChanged(envelope, payload);

    expect(membershipFactsService.recordStatusChanged).toHaveBeenCalledTimes(1);
    expect(membershipDimensionsService.applyStatusChanged).not.toHaveBeenCalled();
  });

  it('claimed=true 이면 정확한 result 객체와 공유 tx 로 dimension 을 갱신한다', async () => {
    const result: MembershipFactResult = {
      claimed: true,
      userId: 'user-1',
      status: 'ACTIVE',
      tierId: 'tier-1',
      occurredAt: new Date('2026-07-01T00:00:00.000Z'),
    };
    const { consumer, tx, membershipFactsService, membershipDimensionsService } = makeConsumer(result);

    await consumer.onMembershipStatusChanged(envelope, payload);

    expect(membershipFactsService.recordStatusChanged).toHaveBeenCalledWith(envelope, payload, tx);
    expect(membershipDimensionsService.applyStatusChanged).toHaveBeenCalledWith(result, tx);
  });
});
