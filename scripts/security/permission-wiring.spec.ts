import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';

/**
 * 권한 판정 가드의 «등록 순서»가 규칙대로인지(APP_GUARD 는 루트 모듈 providers 순서대로 돈다).
 * 관찰 가드가 맨 앞이 아니면 뒤 가드가 거부한 요청을 그림자 판정이 못 본다.
 */
const ROOT = join(__dirname, '..', '..');
const ROOT_MODULES: Record<string, string> = {
  core: 'apps/core/src/app.module.ts',
  notification: 'apps/notification/src/notification.module.ts',
  'channel-adapter': 'apps/channel-adapter/src/adapter.module.ts',
  'user-service': 'apps/user-service/src/app.module.ts',
  membership: 'apps/membership/src/app.module.ts',
  'file-service': 'apps/file-service/src/file-service.module.ts',
  'ugc-service': 'apps/ugc-service/src/ugc-service.module.ts',
  ai: 'apps/ai/src/ai.module.ts',
  wallet: 'apps/wallet/src/wallet.module.ts',
  analytics: 'apps/analytics/src/analytics.module.ts',
  search: 'apps/search/src/search.module.ts',
};
/** 인증 가드가 컨트롤러 단위인 앱 — 강제 가드도 그 자리(JwtAuthGuard 바로 뒤)에 건다. */
const CONTROLLER_LEVEL_AUTH = new Set(['analytics', 'search']);

/** providers 배열에서 `{ provide: APP_GUARD|APP_INTERCEPTOR, useClass: X }` 를 순서대로. */
function enhancers(file: string): { token: string; useClass: string }[] {
  const src = ts.createSourceFile(file, readFileSync(join(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true);
  const out: { token: string; useClass: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const prop = (name: string) =>
        node.properties
          .find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === name)
          ?.initializer.getText();
      const token = prop('provide');
      const useClass = prop('useClass');
      if ((token === 'APP_GUARD' || token === 'APP_INTERCEPTOR') && useClass) out.push({ token, useClass });
    }
    node.forEachChild(visit);
  };
  src.forEachChild(visit);
  return out;
}

describe('권한 판정 배선', () => {
  for (const [app, file] of Object.entries(ROOT_MODULES)) {
    describe(app, () => {
      const list = enhancers(file);
      const guards = list.filter((e) => e.token === 'APP_GUARD').map((e) => e.useClass);

      it('관찰 가드가 전역 가드 맨 앞이다', () => {
        expect(guards[0]).toBe('AuthzObserverGuard');
      });

      // 맨 앞이어야 한다 — 앞선 인터셉터가 next.handle() 없이 응답을 돌려주면(재사용 응답 등) 통과 표시를 못 한다.
      it('그림자 인터셉터가 전역 인터셉터 맨 앞이다', () => {
        const interceptors = list.filter((e) => e.token === 'APP_INTERCEPTOR').map((e) => e.useClass);
        expect(interceptors[0]).toBe('AuthzShadowInterceptor');
      });

      if (CONTROLLER_LEVEL_AUTH.has(app)) {
        it('강제 가드는 전역이 아니다(컨트롤러 인증 뒤에 건다)', () => {
          expect(guards).not.toContain('PermissionGuard');
        });
      } else {
        it('강제 가드가 전역 가드 맨 뒤다', () => {
          expect(guards[guards.length - 1]).toBe('PermissionGuard');
        });
      }

      it('PermissionModule 을 등록한다', () => {
        expect(readFileSync(join(ROOT, file), 'utf8')).toMatch(/PermissionModule\.forRoot\(\{\s*service: '/);
      });
    });
  }

  it('analytics·search 에서 JwtAuthGuard 를 거는 곳마다 바로 뒤에 PermissionGuard 가 있다', () => {
    const files = execSync('grep -rl "UseGuards(JwtAuthGuard" apps/analytics/src apps/search/src --include=*.ts', {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter((f) => f && !f.endsWith('.spec.ts'));
    const offenders = files.flatMap((f) =>
      [...readFileSync(join(ROOT, f), 'utf8').matchAll(/@UseGuards\(([^)]*)\)/g)]
        .map((m) => m[1].split(',').map((s) => s.trim()))
        .filter((list) => list[0] === 'JwtAuthGuard' && list[1] !== 'PermissionGuard')
        .map((list) => `${f}: @UseGuards(${list.join(', ')})`),
    );
    expect(offenders).toEqual([]);
  });

  /** providers 배열에서 그림자 인터셉터 «바로 다음» 원소가 `...piiMaskingProviders(` 펼침인지. */
  function piiMaskingFollowsShadow(file: string): boolean {
    const src = ts.createSourceFile(file, readFileSync(join(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true);
    let found = false;
    const visit = (node: ts.Node): void => {
      if (ts.isArrayLiteralExpression(node)) {
        node.elements.forEach((element, index) => {
          if (!element.getText().includes('useClass: AuthzShadowInterceptor')) return;
          const next = node.elements[index + 1];
          if (next && ts.isSpreadElement(next) && next.expression.getText().startsWith('piiMaskingProviders(')) found = true;
        });
      }
      node.forEachChild(visit);
    };
    src.forEachChild(visit);
    return found;
  }

  const appsDeclaringPii = (): string[] => {
    const out = execSync('grep -rl "@PiiResponse(" apps --include=*.ts || true', { cwd: ROOT, encoding: 'utf8' });
    const apps = out
      .trim()
      .split('\n')
      .filter((f) => f && !f.endsWith('.spec.ts'))
      .map((f) => f.split('/')[1]);
    return [...new Set(apps)].sort();
  };

  it('개인정보 응답을 선언한 앱은 가림 인터셉터를 그림자 인터셉터 바로 다음에 둔다', () => {
    const declaring = appsDeclaringPii();
    expect(declaring.length).toBeGreaterThan(0);
    const missing = declaring.filter((app) => !ROOT_MODULES[app] || !piiMaskingFollowsShadow(ROOT_MODULES[app]));
    expect(missing).toEqual([]);
  });
});
