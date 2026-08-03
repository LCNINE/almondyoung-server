import { Logger } from '@nestjs/common';
import type { DomainEvent } from '@packages/event-contracts/types';
import type { MembershipStatusChangedPayload } from '@packages/event-contracts/streams/membership.stream';
import { factMembershipEvents } from '../../../schema';
import { MembershipFactsService } from './membership-facts.service';

let debugSpy: jest.SpyInstance;

beforeEach(() => {
  // Keep jest output pristine — the duplicate-messageId path logs at debug level.
  debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
});

afterEach(() => {
  debugSpy.mockRestore();
});

function envelope(
  payload: MembershipStatusChangedPayload,
  messageId = '01J00000000000000000000060',
): DomainEvent<MembershipStatusChangedPayload> {
  return {
    messageId,
    messageType: 'MembershipStatusChanged',
    messageVersion: 1,
    messageKind: 'event',
    correlationId: '01J00000000000000000000061',
    timestamp: payload.occurredAt,
    source: { service: 'membership', aggregateType: 'Membership', aggregateId: payload.userId },
    payload,
  };
}

describe('MembershipFactsService', () => {
  function makeService() {
    const claimedMessageIds = new Set<string>();
    const insertedValues: Array<Record<string, unknown>> = [];

    const executor = {
      insert: jest.fn((table: unknown) => {
        if (table !== factMembershipEvents) {
          throw new Error('Unexpected analytics table');
        }
        return {
          values: (values: Record<string, unknown>) => ({
            onConflictDoNothing: () => ({
              returning: () => {
                const messageId = String(values.messageId);
                if (claimedMessageIds.has(messageId)) {
                  return Promise.resolve([]);
                }
                claimedMessageIds.add(messageId);
                insertedValues.push(values);
                return Promise.resolve([{ messageId }]);
              },
            }),
          }),
        };
      }),
    };

    const run = jest.fn((fn: (e: unknown) => unknown, tx?: unknown) => (tx ? fn(tx) : fn(executor)));
    const dbService = { run };
    return { service: new MembershipFactsService(dbService as never), insertedValues };
  }

  const payload: MembershipStatusChangedPayload = {
    userId: 'user-1',
    status: 'ACTIVE',
    occurredAt: '2026-07-01T00:00:00.000Z',
  };

  it('claim 성공 시 fact 행을 기록하고 tierId 미상은 결과에서 UNKNOWN 으로 채운다', async () => {
    const { service, insertedValues } = makeService();
    const event = envelope(payload);

    const result = await service.recordStatusChanged(event, payload);

    expect(result).toEqual({
      claimed: true,
      userId: 'user-1',
      status: 'ACTIVE',
      tierId: 'UNKNOWN',
      contractId: null,
      occurredAt: new Date('2026-07-01T00:00:00.000Z'),
    });
    // The raw fact row is a log of what actually arrived — tierId stays null there, the
    // 'UNKNOWN' substitution only happens in the MembershipFactResult fed to the dimension.
    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0]).toMatchObject({ tierId: null, userId: 'user-1', status: 'ACTIVE' });
  });

  it('같은 messageId 재전달(Kafka redelivery)은 claimed=false 를 반환하고 다시 기록하지 않는다', async () => {
    const { service, insertedValues } = makeService();
    const event = envelope(payload);

    const first = await service.recordStatusChanged(event, payload);
    const duplicate = await service.recordStatusChanged(event, payload);

    expect(first.claimed).toBe(true);
    expect(duplicate).toEqual({
      claimed: false,
      userId: 'user-1',
      status: 'ACTIVE',
      tierId: 'UNKNOWN',
      contractId: null,
      occurredAt: new Date('2026-07-01T00:00:00.000Z'),
    });
    expect(insertedValues).toHaveLength(1);
  });

  it('tierId 가 있으면 그대로 결과와 fact 행 모두에 반영된다', async () => {
    const { service, insertedValues } = makeService();
    const withTier: MembershipStatusChangedPayload = { ...payload, tierId: 'gold' };
    const event = envelope(withTier, '01J00000000000000000000062');

    const result = await service.recordStatusChanged(event, withTier);

    expect(result.tierId).toBe('gold');
    expect(insertedValues[0]).toMatchObject({ tierId: 'gold' });
  });

  it('contractId 를 fact 행과 결과 양쪽에 싣는다', async () => {
    // The dimension needs it too (dim_customer_membership.contract_id) and can only get it
    // through this result — plan 2's backfill keys memberships off contractId, so a null
    // here would leave backfilled and live intervals with no common key to reconcile on.
    const { service, insertedValues } = makeService();
    const withContract: MembershipStatusChangedPayload = { ...payload, contractId: 'contract-1' };
    const event = envelope(withContract, '01J00000000000000000000063');

    const result = await service.recordStatusChanged(event, withContract);

    expect(result.contractId).toBe('contract-1');
    expect(insertedValues[0]).toMatchObject({ contractId: 'contract-1' });
  });
});
