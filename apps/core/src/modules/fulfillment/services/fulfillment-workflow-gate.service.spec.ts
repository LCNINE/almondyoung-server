import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validateAlmondyoungEnv } from '../../../config/env.validation';
import {
  FULFILLMENT_MAINTENANCE_CODE,
  FulfillmentWorkflowGate,
  FulfillmentWorkflowMode,
} from './fulfillment-workflow-gate.service';

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

  // `legacy` 는 V1 출고 경로와 함께 제거됐다. 조용히 v2 로 넘어가면 커토버 워터마크를 무시한 채
  // 출고가 도는 사고가 되므로, 옛 값과 미설정 모두 생성자에서 크게 실패해야 한다.
  it.each([['legacy'], [undefined], ['']])('refuses to construct with a removed or missing mode: %p', (mode) => {
    expect(() => new FulfillmentWorkflowGate(new ConfigService({ FULFILLMENT_WORKFLOW_MODE: mode }))).toThrow(
      /must be 'maintenance' or 'v2'/,
    );
  });

  it('stops enqueue, workers, dispatcher and mutations in maintenance with the stable response code', () => {
    const gate = makeGate('maintenance');

    expect(gate.shouldEnqueueFo(cutoverAt, true)).toBe(false);
    expect(gate.shouldRunFoCreation()).toBe(false);
    expect(gate.shouldRunReservationRetry()).toBe(false);
    expect(gate.shouldRunInvoiceRecovery()).toBe(false);
    expect(gate.shouldDispatchFulfillmentEvents()).toBe(false);

    try {
      gate.assertOperationalMutationAllowed('invoice.void');
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
    expect(gate.shouldRunInvoiceRecovery()).toBe(true);
  });

  // V1 전용 assertMutationAllowed(410) 는 V1 출고 경로와 함께 제거됐다 — v2 에서 남는 게이트 표면은
  // 운영/V2 게이트 둘뿐이고, 모두 통과해야 한다.
  it('allows operational and V2 mutations in v2', () => {
    const gate = makeGate('v2', cutoverAt);

    expect(() => gate.assertOperationalMutationAllowed('fulfillment.drop_ship')).not.toThrow();
    expect(() => gate.assertV2MutationAllowed('shipment.plan')).not.toThrow();
  });

  // 모드가 maintenance|v2 뿐이라 옛 FULFILLMENT_V2_NOT_ACTIVE(409) 분기는 도달 불가가 되어
  // assertMutationAllowed 와 함께 제거됐다. 남은 동작(maintenance 는 V2 명령도 503)을 고정한다.
  it('rejects V2 commands in maintenance with the maintenance code, not the V2-inactive code', () => {
    const gate = makeGate('maintenance');
    try {
      gate.assertV2MutationAllowed('shipment.plan');
      throw new Error('expected maintenance rejection');
    } catch (error) {
      expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
        error: FULFILLMENT_MAINTENANCE_CODE,
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

  // 기본값이 없다. `legacy` 기본값은 "옛 안전 동작 유지" 를 뜻했는데 V1 이 없는 지금 어떤 기본값도
  // 조용히 실제 운영 모드를 고르는 것이 되므로, dev/test 라고 봐주지 않는다.
  it.each([['test'], ['development'], ['production']])('requires an explicit mode in %s', (nodeEnv) => {
    expect(() => validateAlmondyoungEnv({ ...base, NODE_ENV: nodeEnv })).toThrow(
      '[Almondyoung Server] Invalid environment variables',
    );
  });

  it('rejects the removed legacy mode', () => {
    expect(() => validateAlmondyoungEnv({ ...base, NODE_ENV: 'test', FULFILLMENT_WORKFLOW_MODE: 'legacy' })).toThrow(
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
