/**
 * 주소로 브랜드가 갈리는 페이지 트리의 «정적·ISR 금지» 판정. 왜인지는 spec 머리 주석.
 * 루트 레이아웃이 `dynamic = "force-dynamic"` 을 선언하고, 트리 안 어느 파일도 다른 `dynamic`·`revalidate`·
 * `generateStaticParams`·`"use cache"`·`fetchCache = 'force-cache'` 로 뒤집지 않아야 한다.
 */
export const BRAND_PAGE_TREES: readonly {
  name: string;
  appDir: string;
  /** 페이지가 부르는 공용 코드 — 여기서 캐시하면 페이지가 동적이어도 한 주소의 브랜드가 다른 주소에 나간다 */
  sharedDirs: readonly string[];
  nextConfig: string;
}[] = [
  {
    name: 'auth-web (앱 전체 — 기본 주소와 테넌트 도메인을 같은 배포가 받는다)',
    appDir: 'web/auth-web/app',
    sharedDirs: ['web/auth-web/components', 'web/auth-web/lib'],
    nextConfig: 'web/auth-web/next.config.mjs',
  },
  // admin-web 테넌트 셸(티켓 20)이 생기면 그 세그먼트를 여기 더한다.
];

export interface BrandPageStaticViolation {
  readonly path: string;
  readonly rule: 'root-not-force-dynamic' | 'overrides-dynamic' | 'shared-cache';
  readonly detail: string;
}

interface SourceFile {
  readonly path: string;
  readonly content: string;
}

// `https://` 의 `//` 는 주석이 아니다.
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const FORCE_DYNAMIC = /export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/;

const OVERRIDES: readonly { pattern: RegExp; detail: string }[] = [
  // 값을 통째로 잡고 force-dynamic 인지 본다 — `=\s*(?!…)` 꼴은 공백 앞으로 되돌아가 force-dynamic 까지 위반으로 친다.
  { pattern: /export\s+const\s+dynamic\s*=\s*(?!['"]force-dynamic['"])[^\s]/, detail: 'force-dynamic 이 아닌 dynamic' },
  { pattern: /export\s+const\s+revalidate\s*=/, detail: 'revalidate(정적·ISR)' },
  { pattern: /export\s+(async\s+)?function\s+generateStaticParams|export\s+const\s+generateStaticParams/, detail: 'generateStaticParams' },
  { pattern: /^\s*['"]use cache(:[\w-]+)?['"]/m, detail: '"use cache"' },
  { pattern: /export\s+const\s+fetchCache\s*=\s*['"](force-cache|only-cache|default-cache)['"]/, detail: 'fetchCache 캐시' },
];

export function findBrandPageStaticViolations(appDir: string, files: SourceFile[]): BrandPageStaticViolation[] {
  const inTree = files
    .filter((f) => f.path.startsWith(`${appDir}/`))
    .map((f) => ({ path: f.path, content: stripComments(f.content) }));
  const violations: BrandPageStaticViolation[] = [];

  const rootPath = `${appDir}/layout.tsx`;
  const root = inTree.find((f) => f.path === rootPath);
  if (!root || !FORCE_DYNAMIC.test(root.content)) {
    violations.push({
      path: rootPath,
      rule: 'root-not-force-dynamic',
      detail: root ? 'export const dynamic = "force-dynamic" 이 없다' : '루트 레이아웃을 못 찾았다',
    });
  }

  for (const f of inTree) {
    const hit = OVERRIDES.find((o) => o.pattern.test(f.content));
    if (hit) violations.push({ path: f.path, rule: 'overrides-dynamic', detail: hit.detail });
  }
  return violations;
}

const USE_CACHE = /^\s*['"]use cache(:[\w-]+)?['"]/m;

const SHARED_CACHES: readonly { pattern: RegExp; detail: string; configOnly?: boolean }[] = [
  { pattern: USE_CACHE, detail: '"use cache"' },
  { pattern: /\bunstable_cache\s*\(/, detail: 'unstable_cache' },
  { pattern: /\bcacheComponents\s*:\s*true/, detail: 'cacheComponents(정적 셸 사전 렌더)', configOnly: true },
  { pattern: /\boutput\s*:\s*['"]export['"]/, detail: "output: 'export'(정적 내보내기)", configOnly: true },
];

/**
 * 페이지 트리 밖 — 페이지가 부르는 공용 코드와 next 설정 — 에서 주소를 무시하고 캐시하는 것. React `cache()` 는 요청 하나 안의
 * 중복 제거라 괜찮다.
 */
export function findSharedCacheViolations(files: SourceFile[]): BrandPageStaticViolation[] {
  const violations: BrandPageStaticViolation[] = [];
  for (const f of files) {
    const content = stripComments(f.content);
    const isConfig = /(^|\/)next\.config\.\w+$/.test(f.path);
    const hit = SHARED_CACHES.find((c) => (isConfig || !c.configOnly) && c.pattern.test(content));
    if (hit) violations.push({ path: f.path, rule: 'shared-cache', detail: hit.detail });
  }
  return violations;
}
