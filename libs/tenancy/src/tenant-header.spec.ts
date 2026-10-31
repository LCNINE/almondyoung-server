import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { TENANT_CONTEXT_KEY } from './tenant-context';
import { TENANT_HEADER, tenantHeaderOf } from './tenant-header';
import { OutboundTenant, TenancyModule } from './tenancy.module';

const TENANT_LIST = JSON.stringify([
  { id: '1', slug: 'one', coreDb: 'core', publicBucket: 'bucket-one', privateBucket: 'bucket-one' },
  { id: '2', slug: 'two', coreDb: 'core_two', publicBucket: 'bucket-two', privateBucket: 'bucket-two-private' },
]);

function boot(env: Record<string, string>) {
  return Test.createTestingModule({ imports: [ClsModule.forRoot({ global: true }), TenancyModule] })
    .overrideProvider(ConfigService)
    .useValue(new ConfigService({ TENANT_LIST, TENANT_GATE_MODE: 'warn', ...env }))
    .compile();
}

/** 공용 HTTP 클라이언트 쪽 — 다른 서비스를 내부 키로 부를 때 싣는 테넌트 헤더. 규칙은 이벤트 봉투 찍기와 같다. */
describe('OutboundTenant', () => {
  it('맥락의 테넌트를 싣는다', async () => {
    const app = await boot({ SERVED_TENANT_ID: '1' });
    const cls = app.get(ClsService);
    const headers = await cls.run(() => {
      cls.set(TENANT_CONTEXT_KEY, '2');
      return app.get(OutboundTenant).headers();
    });
    expect(headers).toEqual({ [TENANT_HEADER]: '2' });
  });

  it('맥락이 없으면 앱의 T 를 싣는다', async () => {
    const app = await boot({ SERVED_TENANT_ID: '1' });
    expect(app.get(OutboundTenant).headers()).toEqual({ [TENANT_HEADER]: '1' });
    const cls = app.get(ClsService);
    expect(await cls.run(() => app.get(OutboundTenant).headers())).toEqual({ [TENANT_HEADER]: '1' });
  });

  it('맥락도 T 도 없으면 싣지 않는다 — 기본 테넌트로 채우지 않는다', async () => {
    const app = await boot({});
    expect(app.get(OutboundTenant).headers()).toEqual({});
  });

  it('T 가 목록에 없으면 기동하지 않는다', async () => {
    await expect(boot({ SERVED_TENANT_ID: '9' })).rejects.toThrow(/«9» 가 테넌트 목록에 없다/);
  });
});

describe('tenantHeaderOf', () => {
  it('받은 요청의 헤더를 읽고, 빈 값·여러 값은 없음으로 본다', () => {
    expect(tenantHeaderOf({ headers: { [TENANT_HEADER]: ' 2 ' } })).toBe('2');
    expect(tenantHeaderOf({ headers: { [TENANT_HEADER]: '' } })).toBeUndefined();
    expect(tenantHeaderOf({ headers: { [TENANT_HEADER]: ['1', '2'] } })).toBeUndefined();
    expect(tenantHeaderOf({ headers: {} })).toBeUndefined();
  });
});
