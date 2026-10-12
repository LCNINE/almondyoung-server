import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AuthzObserverGuard } from './guards/authz-observer.guard';
import { PermissionGuard } from './guards/permission.guard';
import { AuthzShadowInterceptor } from './interceptors/authz-shadow.interceptor';
import { PermissionModule } from './permission.module';
import { PermissionCache } from './services/permission-cache';
import { PERMISSION_RUNTIME_OPTIONS, PermissionRuntimeOptions } from './services/permission-runtime.options';
import { RolePermissionSource, SnapshotFetch } from './services/role-permission-source';

class StubSource extends RolePermissionSource {
  isConfigured(): boolean {
    return false;
  }

  async fetch(): Promise<SnapshotFetch> {
    return { status: 'not_modified' };
  }
}

describe('PermissionModule', () => {
  const build = (env: Record<string, string>) =>
    Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, ignoreEnvVars: true, load: [() => env] }),
        PermissionModule.forRoot({ service: 'core', source: StubSource }),
      ],
    }).compile();

  it('wires the runtime with enforcement off by default', async () => {
    const module = await build({});
    expect(module.get<PermissionRuntimeOptions>(PERMISSION_RUNTIME_OPTIONS)).toMatchObject({
      service: 'core',
      enforce: false,
      refreshIntervalMs: 30_000,
    });
    expect(module.get(PermissionGuard)).toBeInstanceOf(PermissionGuard);
    expect(module.get(PermissionCache).status().state).toBe('disabled');
  });

  // 앱은 가드·인터셉터를 자기 루트 모듈의 APP_GUARD/APP_INTERCEPTOR 로 건다 — 의존성은 그 모듈 문맥에서 풀린다.
  it('lets an app register the guards and the interceptor globally', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, ignoreEnvVars: true, load: [() => ({})] }),
        PermissionModule.forRoot({ service: 'core', source: StubSource }),
      ],
      providers: [
        { provide: APP_GUARD, useClass: AuthzObserverGuard },
        { provide: APP_GUARD, useClass: PermissionGuard },
        { provide: APP_INTERCEPTOR, useClass: AuthzShadowInterceptor },
      ],
    }).compile();
    const app = module.createNestApplication();
    await expect(app.init()).resolves.toBe(app);
    await app.close();
  });

  it('turns enforcement on only for the exact value true', async () => {
    const enforced = async (value: string) =>
      (await build({ AUTHZ_ENFORCE: value })).get<PermissionRuntimeOptions>(PERMISSION_RUNTIME_OPTIONS).enforce;
    expect(await enforced('true')).toBe(true);
    expect(await enforced('1')).toBe(false);
  });
});
