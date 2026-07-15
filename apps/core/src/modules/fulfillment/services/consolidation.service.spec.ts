import { NotFoundException, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ScopeGuard } from '@app/authorization';
import { PgDialect } from 'drizzle-orm/pg-core';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { ConsolidationController } from '../controllers/consolidation.controller';
import { CreateConsolidationDto } from '../dto/consolidation.dto';
import { canonicalFulfillmentRequestHash } from './fulfillment-command.service';
import {
  canonicalConsolidationRecipient,
  consolidationCompatibilityKey,
  ConsolidationService,
} from './consolidation.service';

const recipient = {
  recipientName: ' Hong   Gil Dong ',
  phone: '010-1234-5678',
  postalCode: ' 12345 ',
  roadAddress: ' Seoul  Road 1 ',
  detailAddress: ' Unit  2 ',
};

function harness(dbService: unknown = {}) {
  const execute = jest.fn((input: { canonicalRequest: unknown }) => Promise.resolve(input.canonicalRequest));
  const authorization = {
    getScopesByRoles: jest
      .fn()
      .mockResolvedValue(
        new Set([
          FULFILLMENT_SCOPE.SHIPMENT_CONSOLIDATE,
          FULFILLMENT_SCOPE.SHIPMENT_OVERRIDE_RECIPIENT,
          FULFILLMENT_SCOPE.SHIPMENT_REOPEN,
        ]),
      ),
  };
  const service = new ConsolidationService(
    dbService as never,
    { execute } as never,
    {} as never,
    {} as never,
    {} as never,
    authorization as never,
    { assertV2MutationAllowed: jest.fn() } as never,
  );
  return { service, execute, authorization };
}

describe('ConsolidationService command boundary', () => {
  const actor = { id: '00000000-0000-4000-8000-000000000099', roles: ['logistics_manager'] };
  const first = '00000000-0000-4000-8000-000000000001';
  const second = '00000000-0000-4000-8000-000000000002';

  it('normalizes recipient fields without fuzzy address matching', () => {
    expect(canonicalConsolidationRecipient(recipient)).toEqual({
      recipientName: 'hong gil dong',
      phone: '01012345678',
      postalCode: '12345',
      roadAddress: 'seoul road 1',
      detailAddress: 'unit 2',
    });
    expect(canonicalConsolidationRecipient({ recipientName: 'incomplete' })).toBeNull();
  });

  it('uses a deterministic opaque compatibility key', () => {
    const left = consolidationCompatibilityKey({
      warehouseId: 'warehouse',
      shippingProfileId: 'profile',
      customerKey: 'customer',
      recipientSnapshot: recipient,
    });
    const right = consolidationCompatibilityKey({
      warehouseId: 'warehouse',
      shippingProfileId: 'profile',
      customerKey: 'customer',
      recipientSnapshot: { ...recipient, phone: '01012345678' },
    });
    expect(left).toBe(right);
    expect(left).toMatch(/^[a-f0-9]{64}$/);
  });

  it('skips only a concurrently removed candidate and propagates unexpected load failures', async () => {
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({ orderBy: () => [{ id: first }] }),
        }),
      }),
    };
    const dbService = { run: (callback: (trx: typeof tx) => unknown) => callback(tx) };
    const removed = harness(dbService).service;
    Object.assign(removed, { loadAggregate: jest.fn().mockRejectedValue(new NotFoundException('removed')) });
    await expect(removed.findCandidates('warehouse')).resolves.toEqual([]);

    const unexpected = new Error('database unavailable');
    const failed = harness(dbService).service;
    Object.assign(failed, { loadAggregate: jest.fn().mockRejectedValue(unexpected) });
    await expect(failed.findCandidates('warehouse')).rejects.toBe(unexpected);
  });

  it('does not treat retired membership in a shared active plan as a consolidation blocker', async () => {
    const predicates: unknown[] = [];
    class Query implements PromiseLike<unknown[]> {
      from(): this {
        return this;
      }
      innerJoin(): this {
        return this;
      }
      where(predicate: unknown): this {
        predicates.push(predicate);
        return this;
      }
      limit(): Promise<unknown[]> {
        return Promise.resolve([]);
      }
      then<TResult1 = unknown[], TResult2 = never>(
        onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): PromiseLike<TResult1 | TResult2> {
        return Promise.resolve([]).then(onfulfilled, onrejected);
      }
    }
    const tx = { select: () => new Query() };
    const service = harness().service as unknown as {
      loadBlockers(
        aggregate: { shipment: { id: string }; lines: Array<{ id: string; inspectedQty: number }> },
        transaction: unknown,
      ): Promise<string[]>;
    };

    await expect(
      service.loadBlockers({ shipment: { id: first }, lines: [{ id: second, inspectedQty: 0 }] }, tx),
    ).resolves.toEqual([]);

    const rendered = predicates.map((predicate) =>
      new PgDialect().sqlToQuery(predicate as never).sql.replace(/\s+/g, ' '),
    );
    expect(
      rendered.some(
        (query) =>
          query.includes('"picking_plan_members"."retired_at" is null') &&
          query.includes('"picking_plans"."status" in'),
      ),
    ).toBe(true);
  });

  it('sorts whole source shipments before hashing so request order is immaterial', async () => {
    const left = harness();
    const right = harness();
    const source = (shipmentId: string, version: number) => ({
      shipmentId,
      expectedManifestVersion: version,
      expectedReservationVersion: version,
    });
    const leftRequest = await left.service.consolidate(
      {
        sources: [source(second, 2), source(first, 1)],
        recipientSourceShipmentId: first,
        reason: 'combine boxes',
      },
      'key',
      actor,
    );
    const rightRequest = await right.service.consolidate(
      {
        sources: [source(first, 1), source(second, 2)],
        recipientSourceShipmentId: first,
        reason: 'combine boxes',
      },
      'key',
      actor,
    );

    expect(canonicalFulfillmentRequestHash(leftRequest)).toBe(canonicalFulfillmentRequestHash(rightRequest));
    expect((leftRequest as { sources: Array<{ shipmentId: string }> }).sources.map((row) => row.shipmentId)).toEqual([
      first,
      second,
    ]);
  });

  it('rejects duplicate sources and ambiguous recipient selection before claiming the command', async () => {
    const { service, execute } = harness();
    const source = { shipmentId: first, expectedManifestVersion: 1, expectedReservationVersion: 1 };
    await expect(
      service.consolidate(
        { sources: [source, source], recipientSourceShipmentId: first, reason: 'duplicate' },
        'key',
        actor,
      ),
    ).rejects.toThrow('Duplicate source shipment ID');
    await expect(
      service.consolidate(
        {
          sources: [source, { ...source, shipmentId: second }],
          recipientSourceShipmentId: first,
          recipientSnapshot: recipient,
          reason: 'ambiguous',
        },
        'key',
        actor,
      ),
    ).rejects.toThrow('Choose exactly one recipient');
    expect(execute).not.toHaveBeenCalled();
  });

  it('takes the actor from JWT and strips a forged body operator', async () => {
    const consolidation = { consolidate: jest.fn().mockResolvedValue({}) };
    const controller = new ConsolidationController(consolidation as never);
    const pipe = new ValidationPipe({ transform: true, whitelist: true });
    const dto = (await pipe.transform(
      {
        sources: [
          { shipmentId: first, expectedManifestVersion: 1, expectedReservationVersion: 1 },
          { shipmentId: second, expectedManifestVersion: 1, expectedReservationVersion: 1 },
        ],
        recipientSourceShipmentId: first,
        reason: 'explicit consolidation',
        operatorId: 'forged-operator',
      },
      { type: 'body', metatype: CreateConsolidationDto },
    )) as CreateConsolidationDto;

    await controller.consolidate(dto, 'key', { userId: actor.id, roles: actor.roles });

    expect(dto).not.toHaveProperty('operatorId');
    expect(consolidation.consolidate).toHaveBeenCalledWith(dto, 'key', actor);
  });

  it('replaces the temporary admin guard with the consolidation scope guard contract', () => {
    const classGuards = Reflect.getMetadata(GUARDS_METADATA, ConsolidationController) as unknown[];
    expect(classGuards).toContain(ScopeGuard);
    expect(Reflect.getMetadata('required_scopes', ConsolidationController.prototype.consolidate)).toEqual([
      FULFILLMENT_SCOPE.SHIPMENT_CONSOLIDATE,
    ]);
  });
});
