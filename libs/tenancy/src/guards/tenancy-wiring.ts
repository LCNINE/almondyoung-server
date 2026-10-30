import { posix } from 'node:path';

export interface SourceFile {
  readonly path: string;
  readonly content: string;
}

export interface TenancyWiringViolation {
  readonly app: string;
  readonly rule: 'tenancy-module-missing' | 'root-module-unresolved' | 'consumer-tenancy-missing';
  readonly detail: string;
}

/** 소비하지 않아도 목록을 읽는 앱 — 버킷을 테넌트 목록에서 고른다. */
const NON_CONSUMER_TENANT_APPS = ['file-service'];

/** `apps/<app>/src/main.ts` 를 받아 그 앱이 테넌트 목록을 받아야 하는지 — Kafka 소비 앱 + file-service. */
export function requiresTenancy(main: SourceFile): boolean {
  return main.content.includes('EventsModule.startConsumer') || NON_CONSUMER_TENANT_APPS.includes(appOf(main.path));
}

/**
 * `startConsumer` 에 선언한 테넌트 모드. 타입이 선언을 강제하지만 «어느 앱이 T 를 받아야 하나»는 이 값에서
 * 도출한다 — SST·로컬 정본이 손으로 적은 목록과 갈리지 않게.
 */
export function consumerTenancyOf(main: SourceFile): 'per-message' | 'served-tenant' | undefined {
  // startConsumer 호출의 옵션 객체 안에서만 찾는다 — 주석·다른 객체의 같은 글자에 속지 않게
  const m = /EventsModule\.startConsumer\(\s*app\s*,\s*\{[^}]*?\btenancy:\s*'(per-message|served-tenant)'/s.exec(
    main.content,
  );
  // as 정당화: 정규식의 캡처 그룹이 바로 이 두 값만 잡는다
  return m ? (m[1] as 'per-message' | 'served-tenant') : undefined;
}

function appOf(path: string): string {
  return path.split('/')[1];
}

/**
 * 테넌트 목록을 받아야 하는 앱의 루트 모듈이 `TenancyModule` 을 import 하는지 본다.
 * `files` 는 `apps/<app>/src/*.ts` (src 바로 아래) 를 받는다 — main.ts 와 루트 모듈이 거기 있다.
 */
export function findTenancyWiringViolations(files: readonly SourceFile[]): TenancyWiringViolation[] {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const violations: TenancyWiringViolation[] = [];
  for (const main of files.filter((f) => /^apps\/[^/]+\/src\/main\.ts$/.test(f.path))) {
    if (!requiresTenancy(main)) continue;
    const app = appOf(main.path);

    const rootModule = /NestFactory\.create(?:<[^>]*>)?\(\s*(\w+)/.exec(main.content)?.[1];
    const from = rootModule
      ? new RegExp(`import\\s*\\{[^}]*\\b${rootModule}\\b[^}]*\\}\\s*from\\s*'(\\.[^']+)'`).exec(main.content)?.[1]
      : undefined;
    const modulePath = from ? posix.join(posix.dirname(main.path), `${from}.ts`) : undefined;
    const moduleSource = modulePath ? byPath.get(modulePath) : undefined;
    if (moduleSource === undefined) {
      violations.push({ app, rule: 'root-module-unresolved', detail: `${main.path} 의 루트 모듈 파일을 못 찾았다` });
      continue;
    }
    if (main.content.includes('EventsModule.startConsumer') && !consumerTenancyOf(main)) {
      violations.push({
        app,
        rule: 'consumer-tenancy-missing',
        detail: `${main.path} 의 startConsumer 가 테넌트 모드(tenancy: 'per-message' | 'served-tenant')를 선언하지 않는다`,
      });
    }
    if (!/\bTenancyModule\b/.test(moduleSource)) {
      violations.push({
        app,
        rule: 'tenancy-module-missing',
        detail: `${modulePath} 가 TenancyModule 을 import 하지 않는다 (@app/tenancy)`,
      });
    }
  }
  return violations;
}
