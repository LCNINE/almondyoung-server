import { ArgumentMetadata, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createGlobalValidationPipe } from '../../../platform/http/validation-pipe';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  REQUIRED_PERMISSIONS_KEY,
  checkpointEvaluations,
  createCheckpointsForTesting,
  PermissionCheckpoints,
} from '@app/authorization';
import { register } from 'prom-client';
import { ConsolidationController } from '../controllers/consolidation.controller';
import {
  ConsolidationOptionsQueryDto,
  ConsolidationOptionsResponseDto,
  ConsolidationProgressResponseDto,
  CreateConsolidationDto,
} from '../dto/consolidation.dto';
import { ConsolidationOptionsService } from './consolidation-options.service';
import { ConsolidationProgressService } from './consolidation-progress.service';
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

// 컨트롤러가 받는 협력자를 부분 스텁으로 바꿔 끼운다. 쓰지 않는 협력자는 빈 객체로 둔다
async function controllerWith(stubs: {
  consolidation?: Partial<ConsolidationService>;
  options?: Partial<ConsolidationOptionsService>;
  progress?: Partial<ConsolidationProgressService>;
}): Promise<ConsolidationController> {
  const moduleRef = await Test.createTestingModule({
    controllers: [ConsolidationController],
    providers: [
      { provide: ConsolidationService, useValue: stubs.consolidation ?? {} },
      { provide: ConsolidationOptionsService, useValue: stubs.options ?? {} },
      { provide: ConsolidationProgressService, useValue: stubs.progress ?? {} },
    ],
  }).compile();
  return moduleRef.get(ConsolidationController);
}

function harness(dbService: unknown = {}, checkpoints: PermissionCheckpoints = createCheckpointsForTesting()) {
  const execute = jest.fn((input: { canonicalRequest: unknown }) => Promise.resolve(input.canonicalRequest));
  const service = new ConsolidationService(
    dbService as never,
    { execute } as never,
    {} as never,
    {} as never,
    {} as never,
    { assertV2MutationAllowed: jest.fn() } as never,
    checkpoints,
  );
  return { service, execute };
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

  it('decides the consolidation check by the permission', async () => {
    register.resetMetrics();
    const { service, execute } = harness(
      {},
      createCheckpointsForTesting({ logistics_manager: ['fulfillment.shipment.consolidate'] }),
    );
    const source = { shipmentId: first, expectedManifestVersion: 1, expectedReservationVersion: 1 };
    await expect(
      service.consolidate({ sources: [source], recipientSourceShipmentId: first, reason: 'one' }, 'key', actor),
    ).rejects.toThrow('At least two source shipments are required');
    expect(execute).not.toHaveBeenCalled();
    expect(await checkpointEvaluations('fulfillment.consolidation_scope', 'allow')).toBe(1);
  });

  it('denies consolidation without the permission before claiming the command', async () => {
    register.resetMetrics();
    const { service, execute } = harness({}, createCheckpointsForTesting({ logistics_manager: [] }));
    const source = { shipmentId: first, expectedManifestVersion: 1, expectedReservationVersion: 1 };
    await expect(
      service.consolidate({ sources: [source], recipientSourceShipmentId: first, reason: 'one' }, 'key', actor),
    ).rejects.toThrow('Missing required scope: fulfillment.shipment.consolidate');
    expect(execute).not.toHaveBeenCalled();
    expect(await checkpointEvaluations('fulfillment.consolidation_scope', 'deny')).toBe(1);
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

  it('routes consolidation options through the service layer', async () => {
    const response: ConsolidationOptionsResponseDto = {
      source: {
        shipmentId: first,
        status: 'planned',
        salesOrderNos: [],
        itemSummary: '',
        totalQty: 0,
        recipientSnapshot: {},
        batchId: null,
        waybillTrackingNo: null,
        manifestVersion: 1,
        reservationVersion: 1,
        createdAt: new Date(0),
      },
      options: [],
    };
    const options: Pick<ConsolidationOptionsService, 'findOptions'> = {
      findOptions: jest.fn().mockResolvedValue(response),
    };
    const controller = await controllerWith({ options });

    await expect(controller.findOptions({ shipmentId: first })).resolves.toBe(response);
    expect(options.findOptions).toHaveBeenCalledWith(first);
  });

  it('rejects consolidation options without a UUID shipmentId query', async () => {
    const pipe = createGlobalValidationPipe();
    const meta: ArgumentMetadata = { type: 'query', metatype: ConsolidationOptionsQueryDto };

    await expect(pipe.transform({}, meta)).rejects.toThrow();
    await expect(pipe.transform({ shipmentId: 'not-a-uuid' }, meta)).rejects.toThrow();
    await expect(pipe.transform({ shipmentId: first }, meta)).resolves.toEqual({ shipmentId: first });
  });

  it('routes consolidation progress through the service layer', async () => {
    const response: ConsolidationProgressResponseDto = {
      operationId: 'op',
      status: 'pending',
      targetShipmentId: null,
      sources: [],
    };
    const progress: Pick<ConsolidationProgressService, 'findForShipment'> = {
      findForShipment: jest.fn().mockResolvedValue(response),
    };
    const controller = await controllerWith({ progress });

    await expect(controller.findProgress(first)).resolves.toBe(response);
    expect(progress.findForShipment).toHaveBeenCalledWith(first);
  });

  it('takes the actor from JWT and strips a forged body operator', async () => {
    const consolidation: Pick<ConsolidationService, 'consolidate'> = { consolidate: jest.fn().mockResolvedValue({}) };
    const controller = await controllerWith({ consolidation });
    const pipe = createGlobalValidationPipe();
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

  it('requires the consolidation permission with no legacy guard on the controller', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ConsolidationController)).toBeUndefined();
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, ConsolidationController.prototype.consolidate)).toEqual([
      'fulfillment.shipment.consolidate',
    ]);
  });
});
