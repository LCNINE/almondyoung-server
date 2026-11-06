import { REQUIRED_PERMISSIONS_KEY } from '@app/authorization';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OutboundPreparationController } from './outbound-preparation.controller';
import { OutboundPreparationManager } from './outbound-preparation.manager';
import { OutboundPreparationReader } from './outbound-preparation.reader';
import { OutboundPreparationService } from './outbound-preparation.service';

describe('OutboundPreparationController', () => {
  const planMany = jest.fn().mockResolvedValue({ succeeded: ['s1'], failed: [] });
  const summarize = jest.fn().mockResolvedValue({ warehouseId: 'w1', buckets: [], awaitingMatchingCount: 0 });
  let controller: OutboundPreparationController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      controllers: [OutboundPreparationController],
      providers: [
        OutboundPreparationService,
        { provide: OutboundPreparationManager, useValue: { planMany } },
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

  it('preserves summary delegation', async () => {
    await expect(controller.summarize({ warehouseId: 'w1' })).resolves.toEqual({
      warehouseId: 'w1',
      buckets: [],
      awaitingMatchingCount: 0,
    });
    expect(summarize).toHaveBeenCalledWith('w1', undefined);
  });
});
