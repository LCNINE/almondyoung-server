import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { RequirePermission } from './decorators/require-permission.decorator';
import { Test } from '@nestjs/testing';
import { AuthzObserverGuard } from './guards/authz-observer.guard';
import { PermissionGuard } from './guards/permission.guard';
import { AuthzShadowInterceptor } from './interceptors/authz-shadow.interceptor';
import { PermissionModule } from './permission.module';
import { PermissionCache } from './services/permission-cache';
import { PermissionCheckpoints } from './services/permission-checkpoints';
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

/** 역할 `intern` 은 아무 권한도 없다 — 사본은 있으니 판정은 «권한 없음»(403)이다. */
class ReadySource extends RolePermissionSource {
  isConfigured(): boolean {
    return true;
  }

  async fetch(): Promise<SnapshotFetch> {
    return { status: 'loaded', snapshot: { version: 'v1', roles: new Map([['intern', []]]) } };
  }
}

class Routes {
  @RequirePermission('order.order.read')
  read(): void {}
}

describe('PermissionModule', () => {
  const build = (env: Record<string, string>) =>
    Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, ignoreEnvVars: true, load: [() => env] }),
        PermissionModule.forRoot({ service: 'core', source: StubSource }),
      ],
    }).compile();

  it('wires the runtime', async () => {
    const module = await build({});
    const options = module.get<PermissionRuntimeOptions>(PERMISSION_RUNTIME_OPTIONS);
    expect(options).toMatchObject({ service: 'core', refreshIntervalMs: 30_000 });
    expect(Object.keys(options)).not.toContain('enforce');
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

  it('lets an app service inject the handler checkpoints', async () => {
    @Injectable()
    class UsesCheckpoints {
      constructor(readonly checkpoints: PermissionCheckpoints) {}
    }
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, ignoreEnvVars: true, load: [() => ({})] }),
        PermissionModule.forRoot({ service: 'core', source: StubSource }),
      ],
      providers: [UsesCheckpoints],
    }).compile();
    expect(module.get(UsesCheckpoints).checkpoints).toBeInstanceOf(PermissionCheckpoints);
  });

  // 판정은 설정으로 끌 수 없다 — 옛 스위치 값이 무엇이든 권한 없는 호출은 거부된다.
  it.each([[{}], [{ AUTHZ_ENFORCE: 'false' }], [{ AUTHZ_ENFORCE: '' }]])(
    'refuses a caller without the permission whatever the old switch says (%j)',
    async (env: Record<string, string>) => {
      const module = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ ignoreEnvFile: true, ignoreEnvVars: true, load: [() => env] }),
          PermissionModule.forRoot({ service: 'core', source: ReadySource }),
        ],
      }).compile();
      await module.get(PermissionCache).refresh();
      const context = new ExecutionContextHost(
        [{ user: { userId: 'u', sub: 'u', roles: ['intern'] } }, {}],
        Routes,
        Routes.prototype.read,
      );
      context.setType('http');
      let error: unknown;
      try {
        module.get(PermissionGuard).canActivate(context);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error instanceof ForbiddenException ? error.getResponse() : undefined).toMatchObject({
        requiredPermissions: ['order.order.read'],
      });
    },
  );

  it('logs the authz mode once at boot', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const module = await build({});
    await module.createNestApplication().init();
    const lines = log.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith('authz mode'));
    expect(lines).toEqual(['authz mode: enforce (core)']);
    log.mockRestore();
  });
});

