import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND_PAGE_TREES, findBrandPageStaticViolations, findSharedCacheViolations } from './brand-pages-dynamic';

/**
 * 들어온 주소로 브랜드가 갈리는 페이지(auth-web 전체, admin-web 테넌트 셸)는 언제나 요청마다 그린다.
 *
 * OpenNext 캐시 키에 Host 가 없다 — 정적·ISR 로 구우면 한 주소에서 그린 브랜드가 다른 주소에 그대로 나간다(테넌트 도메인에
 * 아몬드영 화면, 혹은 그 반대). Next 는 `headers()` 를 읽으면 동적으로 바꿔 주지만, 누가 `dynamic = 'force-static'`·
 * `revalidate` 를 달면 `headers()` 가 빈 값이 되며 조용히 구워진다. 그래서 트리의 루트 레이아웃이 `force-dynamic` 을 선언하고,
 * 그 아래 어떤 파일도 그걸 뒤집지 않음을 본다. 페이지가 부르는 공용 코드(components·lib)의 `"use cache"`·`unstable_cache` 와
 * next 설정의 `cacheComponents`·`output: 'export'` 도 같은 사고라 함께 본다. 근거: 비공개 ADR 0008 교정.
 */
const file = (path: string, content: string) => ({ path, content });
const ROOT = 'app/layout.tsx';
const layout = `export const dynamic = "force-dynamic"\nexport default function L() { return null }\n`;

describe('findBrandPageStaticViolations (픽스처)', () => {
  it('루트 레이아웃이 force-dynamic 이고 뒤집는 파일이 없으면 통과', () => {
    expect(
      findBrandPageStaticViolations('app', [file(ROOT, layout), file('app/signin/page.tsx', 'export default 1')]),
    ).toEqual([]);
  });

  it("루트 레이아웃에 force-dynamic 이 없으면 위반 — 주석 안의 선언은 치지 않는다", () => {
    expect(findBrandPageStaticViolations('app', [file(ROOT, 'export default 1')])).toEqual([
      expect.objectContaining({ path: ROOT, rule: 'root-not-force-dynamic' }),
    ]);
    expect(
      findBrandPageStaticViolations('app', [file(ROOT, '// export const dynamic = "force-dynamic"\nexport default 1')]),
    ).toEqual([expect.objectContaining({ rule: 'root-not-force-dynamic' })]);
  });

  it('루트 레이아웃이 없으면 위반 — 못 찾은 것을 통과로 치지 않는다', () => {
    expect(findBrandPageStaticViolations('app', [file('app/page.tsx', 'x')])).toEqual([
      expect.objectContaining({ path: ROOT, rule: 'root-not-force-dynamic' }),
    ]);
  });

  it.each([
    ["dynamic = 'force-static'", "export const dynamic = 'force-static'"],
    ['dynamic = "error"', 'export const dynamic = "error"'],
    ['dynamic = "auto"', 'export const dynamic = "auto"'],
    ['revalidate = 60 (ISR)', 'export const revalidate = 60'],
    ['revalidate = false', 'export const revalidate = false'],
    ['generateStaticParams', 'export async function generateStaticParams() { return [] }'],
    ['"use cache"', '"use cache"\nexport default async function P() {}'],
    ["fetchCache = 'force-cache'", "export const fetchCache = 'force-cache'"],
  ])('아래 파일의 %s 는 위반', (_label, content) => {
    expect(findBrandPageStaticViolations('app', [file(ROOT, layout), file('app/signin/page.tsx', content)])).toEqual([
      expect.objectContaining({ path: 'app/signin/page.tsx', rule: 'overrides-dynamic' }),
    ]);
  });

  it('트리 밖 파일은 보지 않는다', () => {
    expect(
      findBrandPageStaticViolations('app', [file(ROOT, layout), file('lib/x.ts', "export const dynamic = 'force-static'")]),
    ).toEqual([]);
  });
});

describe('findSharedCacheViolations (픽스처) — 페이지가 부르는 공용 코드·next 설정', () => {
  it.each([
    ['"use cache" 함수', 'lib/site.ts', 'export async function f() {\n  "use cache"\n  return 1\n}'],
    ['unstable_cache', 'components/shell.tsx', 'import { unstable_cache } from "next/cache"\nconst g = unstable_cache(async () => 1)'],
    ['next.config 의 cacheComponents', 'next.config.mjs', 'const c = { cacheComponents: true }\nexport default c'],
    ["next.config 의 output: 'export'", 'next.config.mjs', "const c = { output: 'export' }\nexport default c"],
  ])('%s 는 위반', (_label, path, content) => {
    expect(findSharedCacheViolations([file(path, content)])).toEqual([expect.objectContaining({ path })]);
  });

  it('cache() (요청 하나 안의 중복 제거)·주석은 통과', () => {
    expect(
      findSharedCacheViolations([
        file('lib/site.ts', 'import { cache } from "react"\nexport const getSite = cache(async () => 1)\n// "use cache" 는 쓰지 않는다'),
        file('next.config.mjs', 'const c = { turbopack: {} }\nexport default c'),
      ]),
    ).toEqual([]);
  });
});

describe('브랜드 페이지는 언제나 동적이다 (실제 트리)', () => {
  const REPO = join(__dirname, '..', '..');

  const filesUnder = (dirs: readonly string[]) =>
    execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...dirs], {
      cwd: REPO,
      encoding: 'utf8',
    })
      .split('\n')
      // 지웠지만 아직 커밋하지 않은 파일도 ls-files 에 남는다
      .filter((p) => /\.(ts|tsx|js|jsx|mjs)$/.test(p) && existsSync(join(REPO, p)))
      .map((path) => ({ path, content: readFileSync(join(REPO, path), 'utf8') }));

  it.each(BRAND_PAGE_TREES.map((t) => [t.name, t]))('%s — 페이지 트리', (_name, tree) => {
    const files = filesUnder([tree.appDir]);
    expect(files.length).toBeGreaterThan(0);
    expect(findBrandPageStaticViolations(tree.appDir, files)).toEqual([]);
  });

  it.each(BRAND_PAGE_TREES.map((t) => [t.name, t]))('%s — 공용 코드·next 설정', (_name, tree) => {
    const files = filesUnder([...tree.sharedDirs, tree.nextConfig]);
    expect(files.some((f) => f.path === tree.nextConfig)).toBe(true);
    expect(files.length).toBeGreaterThan(1);
    expect(findSharedCacheViolations(files)).toEqual([]);
  });
});
