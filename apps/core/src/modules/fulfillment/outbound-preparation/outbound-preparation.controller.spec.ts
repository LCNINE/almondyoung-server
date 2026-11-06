import { REQUIRED_PERMISSIONS_KEY } from '@app/authorization';
import { BadRequestException, ParseUUIDPipe, UnauthorizedException } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OutboundPreparationController } from './outbound-preparation.controller';
import { OutboundPreparationManager } from './outbound-preparation.manager';
import { OutboundPreparationReader } from './outbound-preparation.reader';
import { OutboundPreparationService } from './outbound-preparation.service';

describe('OutboundPreparationController', () => {
  const issueWaybills = jest.fn().mockResolvedValue([]);
  const planMany = jest.fn().mockResolvedValue({ succeeded: ['s1'], failed: [] });
  const addManyToBatch = jest.fn().mockResolvedValue({ succeeded: ['s1'], failed: [] });
  const splitManyUnreserved = jest.fn().mockResolvedValue({ succeeded: ['s1'], failed: [] });
  const summarize = jest.fn().mockResolvedValue({ warehouseId: 'w1', buckets: [], awaitingMatchingCount: 0 });
  let controller: OutboundPreparationController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      controllers: [OutboundPreparationController],
      providers: [
        OutboundPreparationService,
        {
          provide: OutboundPreparationManager,
          useValue: { planMany, addManyToBatch, splitManyUnreserved, issueWaybills },
        },
        { provide: OutboundPreparationReader, useValue: { summarize } },
      ],
    }).compile();

    controller = module.get(OutboundPreparationController);
  });

  it.each([{ userId: 'u1' }, { id: 'u1' }, { sub: 'u1' }])(
    'delegates through the service with actor %j',
    async (user) => {
      await expect(
        controller.planMany({ shipmentIds: ['s1'] }, 'k', { ...user, roles: ['warehouse'] }),
      ).resolves.toEqual({
        succeeded: ['s1'],
        failed: [],
      });
      expect(planMany).toHaveBeenCalledWith(['s1'], 'k', { id: 'u1', roles: ['warehouse'] });
    },
  );

  it.each([undefined, '', '   '])('rejects a missing or blank key before delegation: %p', (key) => {
    expect(() => controller.planMany({ shipmentIds: ['s1'] }, key, { userId: 'u1' })).toThrow(BadRequestException);
    expect(planMany).not.toHaveBeenCalled();
  });

  it('rejects an absent actor', () => {
    expect(() => controller.planMany({ shipmentIds: ['s1'] }, 'k', undefined)).toThrow(UnauthorizedException);
    expect(planMany).not.toHaveBeenCalled();
  });

  it('declares the POST route and warehouse permission', () => {
    const method = OutboundPreparationController.prototype.planMany;

    expect(Reflect.getMetadata(PATH_METADATA, method)).toBe('outbound-preparation/plans');
    expect(Reflect.getMetadata(METHOD_METADATA, method)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, method)).toEqual(['fulfillment.warehouse.operate']);
  });

  it('delegates the waybill route with the existing issue permission', async () => {
    await expect(controller.issueWaybills({ shipmentIds: ['s1'] }, 'k', { id: 'u1' })).resolves.toEqual([]);
    expect(issueWaybills).toHaveBeenCalledWith(['s1'], 'k', { id: 'u1', roles: [] });

    const method = OutboundPreparationController.prototype.issueWaybills;

    expect(Reflect.getMetadata(PATH_METADATA, method)).toBe('outbound-preparation/waybills');
    expect(Reflect.getMetadata(METHOD_METADATA, method)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, method)).toEqual(['fulfillment.warehouse.operate']);
  });

  it.each([undefined, '', '   '])('rejects a blank waybill key: %p', (key) => {
    expect(() => controller.issueWaybills({ shipmentIds: ['s1'] }, key, { id: 'u1' })).toThrow(BadRequestException);
    expect(issueWaybills).not.toHaveBeenCalled();
  });

  it('rejects waybill issuance without an actor', () => {
    expect(() => controller.issueWaybills({ shipmentIds: ['s1'] }, 'k', undefined)).toThrow(UnauthorizedException);
    expect(issueWaybills).not.toHaveBeenCalled();
  });

  it('preserves summary delegation', async () => {
    await expect(controller.summarize({ warehouseId: 'w1' })).resolves.toEqual({
      warehouseId: 'w1',
      buckets: [],
      awaitingMatchingCount: 0,
    });
    expect(summarize).toHaveBeenCalledWith('w1', undefined);
  });

  describe.each([
    { method: 'addManyToBatch', path: 'outbound-preparation/batches/:batchId/shipments' },
    { method: 'splitManyUnreserved', path: 'outbound-preparation/unreserved-splits' },
  ])('$method', ({ method, path }) => {
    function invoke(key: string | undefined, user: Parameters<OutboundPreparationController['planMany']>[2]) {
      if (method === 'addManyToBatch') {
        return controller.addManyToBatch('b1', { shipmentIds: ['s1'] }, key, user);
      }

      return controller.splitManyUnreserved({ shipmentIds: ['s1'] }, key, user);
    }

    it.each([{ userId: 'u1' }, { id: 'u1' }, { sub: 'u1' }])('delegates with actor %j', async (user) => {
      await expect(invoke('k', { ...user, roles: ['warehouse'] })).resolves.toEqual({ succeeded: ['s1'], failed: [] });

      if (method === 'addManyToBatch') {
        expect(addManyToBatch).toHaveBeenCalledWith('b1', ['s1'], 'k', { id: 'u1', roles: ['warehouse'] });
      } else {
        expect(splitManyUnreserved).toHaveBeenCalledWith(['s1'], 'k', { id: 'u1', roles: ['warehouse'] });
      }
    });

    it.each([undefined, '', '   '])('rejects a missing or blank key: %p', (key) => {
      expect(() => invoke(key, { userId: 'u1' })).toThrow(BadRequestException);
      expect(addManyToBatch).not.toHaveBeenCalled();
      expect(splitManyUnreserved).not.toHaveBeenCalled();
    });

    it('rejects an absent actor', () => {
      expect(() => invoke('k', undefined)).toThrow(UnauthorizedException);
      expect(addManyToBatch).not.toHaveBeenCalled();
      expect(splitManyUnreserved).not.toHaveBeenCalled();
    });

    it('declares the POST route and warehouse permission', () => {
      const handler =
        method === 'addManyToBatch'
          ? OutboundPreparationController.prototype.addManyToBatch
          : OutboundPreparationController.prototype.splitManyUnreserved;

      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
      expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler)).toEqual(['fulfillment.warehouse.operate']);
    });
  });

  it('validates batchId as a UUID at the route boundary', () => {
    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, OutboundPreparationController, 'addManyToBatch');

    expect(args).toEqual(
      expect.objectContaining({
        '5:0': expect.objectContaining({ data: 'batchId', pipes: [expect.any(ParseUUIDPipe)] }),
      }),
    );
  });
});
