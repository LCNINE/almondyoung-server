import { DemoController } from './demo.controller';
import { DemoModule } from './demo.module';
import type { DemoService } from './demo.service';

describe('DemoModule stage registration', () => {
  it('registers the controller only for the exact safe demo environment', () => {
    const enabled = DemoModule.forEnvironment({
      APP_STAGE: 'demo',
      DEMO_CONSOLE_ENABLED: 'true',
      EXTERNAL_INTEGRATIONS_MODE: 'mock',
    });
    const live = DemoModule.forEnvironment({
      APP_STAGE: 'live',
      DEMO_CONSOLE_ENABLED: 'false',
      EXTERNAL_INTEGRATIONS_MODE: 'real',
    });

    expect(enabled.controllers).toContain(DemoController);
    expect(live.controllers ?? []).not.toContain(DemoController);
  });

  it('returns the catalog/readiness DTO and invokes the existing full recomputation', async () => {
    const catalog = { fixtureVersion: 'demo-logistics-v1', items: [{ variantId: 'v1' }] };
    const readiness = { enabled: true, fixtureVersion: 'demo-logistics-v1', ready: true };
    const recompute = { series: 'full' };
    const service = {
      catalog: jest.fn().mockResolvedValue(catalog),
      readiness: jest.fn().mockResolvedValue(readiness),
      recompute: jest.fn().mockResolvedValue(recompute),
    } as unknown as DemoService;
    const controller = new DemoController(service);

    await expect(controller.catalog()).resolves.toEqual(catalog);
    await expect(controller.readiness()).resolves.toEqual(readiness);
    await expect(controller.recompute()).resolves.toEqual(recompute);
  });
});
