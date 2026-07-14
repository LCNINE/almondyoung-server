import { ServiceUnavailableException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { validateAlmondyoungEnv } from '../../../config/env.validation';
import {
  FULFILLMENT_MAINTENANCE_CODE,
  FULFILLMENT_LEGACY_CLOSED_CODE,
  FULFILLMENT_V2_NOT_ACTIVE_CODE,
  FulfillmentWorkflowGate,
  FulfillmentWorkflowMode,
} from './fulfillment-workflow-gate.service';
import { ConsolidationController } from '../controllers/consolidation.controller';
import { InvoiceController } from '../controllers/invoice.controller';
import { ShipmentController } from '../controllers/shipment.controller';

describe('FulfillmentWorkflowGate', () => {
  const cutoverAt = '2026-07-14T03:00:00.000Z';

  function makeGate(mode: FulfillmentWorkflowMode, configuredCutover?: string) {
    return new FulfillmentWorkflowGate(
      new ConfigService({
        FULFILLMENT_WORKFLOW_MODE: mode,
        FULFILLMENT_V2_CUTOVER_AT: configuredCutover,
      }),
    );
  }

  it('allows characterized legacy enqueue behavior and workers', () => {
    const gate = makeGate('legacy');

    expect(gate.shouldEnqueueFo(undefined, false)).toBe(true);
    expect(gate.shouldRunFoCreation()).toBe(true);
    expect(gate.shouldRunReservationRetry()).toBe(true);
    expect(() => gate.assertMutationAllowed('shipment.force')).not.toThrow();
  });

  it('stops enqueue, workers, dispatcher and mutations in maintenance with the stable response code', () => {
    const gate = makeGate('maintenance');

    expect(gate.shouldEnqueueFo(cutoverAt, true)).toBe(false);
    expect(gate.shouldRunFoCreation()).toBe(false);
    expect(gate.shouldRunReservationRetry()).toBe(false);
    expect(gate.shouldDispatchFulfillmentEvents()).toBe(false);

    try {
      gate.assertMutationAllowed('invoice.void');
      throw new Error('expected maintenance rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getStatus()).toBe(503);
      expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
        error: FULFILLMENT_MAINTENANCE_CODE,
        code: FULFILLMENT_MAINTENANCE_CODE,
        mutationKind: 'invoice.void',
      });
    }
  });

  it('in v2 enqueues only a newly-created SO whose domain time is at or after cutover', () => {
    const gate = makeGate('v2', cutoverAt);

    expect(gate.shouldEnqueueFo('2026-07-14T02:59:59.999Z', true)).toBe(false);
    expect(gate.shouldEnqueueFo(cutoverAt, true)).toBe(true);
    expect(gate.shouldEnqueueFo('2026-07-14T03:00:00.001Z', true)).toBe(true);
    expect(gate.shouldEnqueueFo('2026-07-14T03:00:00.001Z', false)).toBe(false);
  });

  it('keeps legacy mutations closed in v2 while retaining the explicit drop-ship path', () => {
    const gate = makeGate('v2', cutoverAt);

    expect(() => gate.assertMutationAllowed('shipment.open')).toThrow();
    try {
      gate.assertMutationAllowed('invoice.issue');
      throw new Error('expected legacy mutation rejection');
    } catch (error) {
      expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
        error: FULFILLMENT_LEGACY_CLOSED_CODE,
        mutationKind: 'invoice.issue',
      });
    }
    expect(() => gate.assertOperationalMutationAllowed('fulfillment.drop_ship')).not.toThrow();
    expect(() => gate.assertV2MutationAllowed('shipment.plan')).not.toThrow();
  });

  it('does not allow V2 commands before V2 activation', () => {
    const gate = makeGate('legacy');
    try {
      gate.assertV2MutationAllowed('shipment.plan');
      throw new Error('expected V2 inactive rejection');
    } catch (error) {
      expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
        error: FULFILLMENT_V2_NOT_ACTIVE_CODE,
      });
    }
  });

  it('fails closed for missing or unparseable domain time in v2', () => {
    const gate = makeGate('v2', cutoverAt);

    expect(gate.shouldEnqueueFo(undefined, true)).toBe(false);
    expect(gate.shouldEnqueueFo('not-a-timestamp', true)).toBe(false);
  });

  it('exposes mode and watermark as health details', () => {
    expect(makeGate('v2', cutoverAt).getHealthDetails()).toEqual({
      mode: 'v2',
      cutoverAt,
    });
  });
});

describe('fulfillment workflow environment validation', () => {
  const base = {
    AUTH_SECRET: 'test-secret',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    KAFKA_BROKERS: 'localhost:9092',
  };

  it('defaults to legacy only outside production', () => {
    expect(validateAlmondyoungEnv({ ...base, NODE_ENV: 'test' }).FULFILLMENT_WORKFLOW_MODE).toBe('legacy');
  });

  it('rejects a missing mode in production', () => {
    expect(() => validateAlmondyoungEnv({ ...base, NODE_ENV: 'production' })).toThrow(
      '[Almondyoung Server] Invalid environment variables',
    );
  });

  it('requires a valid ISO cutover timestamp in v2', () => {
    expect(() => validateAlmondyoungEnv({ ...base, NODE_ENV: 'production', FULFILLMENT_WORKFLOW_MODE: 'v2' })).toThrow(
      '[Almondyoung Server] Invalid environment variables',
    );
    expect(() =>
      validateAlmondyoungEnv({
        ...base,
        NODE_ENV: 'production',
        FULFILLMENT_WORKFLOW_MODE: 'v2',
        FULFILLMENT_V2_CUTOVER_AT: 'invalid',
      }),
    ).toThrow('[Almondyoung Server] Invalid environment variables');
  });

  it('accepts v2 with a valid cutover timestamp', () => {
    expect(
      validateAlmondyoungEnv({
        ...base,
        NODE_ENV: 'production',
        FULFILLMENT_WORKFLOW_MODE: 'v2',
        FULFILLMENT_V2_CUTOVER_AT: '2026-07-14T03:00:00.000Z',
      }).FULFILLMENT_V2_CUTOVER_AT,
    ).toBe('2026-07-14T03:00:00.000Z');
  });
});

describe('workflow-gated legacy mutation controllers', () => {
  const maintenanceGate = new FulfillmentWorkflowGate(new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'maintenance' }));

  it('rejects invoice void and force shipment before invoking their legacy services', async () => {
    const invoiceService = { cancelInvoice: jest.fn() };
    const shipmentService = { forceShipment: jest.fn() };

    await expect(
      new InvoiceController(invoiceService as never, maintenanceGate).cancelInvoice('invoice-1'),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: FULFILLMENT_MAINTENANCE_CODE }) });
    await expect(
      new ShipmentController(shipmentService as never, maintenanceGate).force('shipment-1', {}, undefined),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: FULFILLMENT_MAINTENANCE_CODE }) });
    expect(invoiceService.cancelInvoice).not.toHaveBeenCalled();
    expect(shipmentService.forceShipment).not.toHaveBeenCalled();
  });

  it('returns 410 from the fake consolidation mutation without invoking the stub service', async () => {
    const consolidationService = { autoConsolidate: jest.fn() };

    await expect(
      new ConsolidationController(consolidationService as never).autoConsolidate('group-1'),
    ).rejects.toMatchObject({ status: 410 });
    expect(consolidationService.autoConsolidate).not.toHaveBeenCalled();
  });

  it.each([
    [InvoiceController, 'cancelInvoice'],
    [ShipmentController, 'force'],
    [ConsolidationController, 'autoConsolidate'],
  ])('allows only admin or master roles through the temporary %p.%s guard', (controller, method) => {
    const handler = controller.prototype[method as keyof typeof controller.prototype];
    const [Guard] = Reflect.getMetadata(GUARDS_METADATA, handler) as Array<
      new () => {
        canActivate(context: unknown): boolean;
      }
    >;
    const guard = new Guard();
    const contextFor = (roles?: string[]) =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ user: roles ? { roles } : undefined }) }),
      }) as never;

    expect(guard.canActivate(contextFor(['admin']))).toBe(true);
    expect(guard.canActivate(contextFor(['master']))).toBe(true);
    expect(guard.canActivate(contextFor(['operator']))).toBe(false);
    expect(guard.canActivate(contextFor())).toBe(false);
  });
});
