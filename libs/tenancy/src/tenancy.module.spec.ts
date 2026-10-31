import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TenancyConfig, TenancyModule } from './tenancy.module';

const TENANT_LIST = JSON.stringify([
  { id: '1', slug: 'almondyoung', coreDb: 'core', publicBucket: 'almondyoung-demo', privateBucket: 'almondyoung-demo' },
]);

/** process.env 를 건드리지 않고 «이 env 로 부팅하면» 을 잰다. */
function boot(env: Record<string, string>) {
  return Test.createTestingModule({ imports: [TenancyModule] })
    .overrideProvider(ConfigService)
    .useValue(new ConfigService(env))
    .compile();
}

describe('TenancyModule — 부팅 때 목록·모드를 읽는다', () => {
  it('목록과 모드가 옳으면 TenancyConfig 로 꺼낼 수 있다', async () => {
    const app = await boot({ TENANT_LIST, TENANT_GATE_MODE: 'warn' });
    const config = app.get(TenancyConfig);
    expect(config.gateMode).toBe('warn');
    expect(config.tenants.find('1')?.coreDb).toBe('core');
  });

  it('모드가 없으면 기동하지 않는다', async () => {
    await expect(boot({ TENANT_LIST })).rejects.toThrow(/TENANT_GATE_MODE 가 없다/);
  });

  it('목록이 틀리면 기동하지 않는다', async () => {
    await expect(boot({ TENANT_LIST: '[]', TENANT_GATE_MODE: 'reject' })).rejects.toThrow(/테넌트가 하나도 없다/);
  });

  it('둘 다 틀리면 한 번에 다 알려 준다 — 하나 고치고 재배포, 또 하나 고치고 재배포를 막는다', async () => {
    await expect(boot({})).rejects.toThrow(/TENANT_LIST 가 없다[\s\S]*TENANT_GATE_MODE 가 없다/);
  });
});
