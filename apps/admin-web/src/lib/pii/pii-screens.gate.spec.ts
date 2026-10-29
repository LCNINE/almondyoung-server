import { join } from 'node:path';
import {
  PII_RECIPIENT_ROUTES,
  PII_REVEAL_ROUTES,
  PII_ROUTES,
} from '../../../../../scripts/security/pii-routes';
import { MEDUSA_PII_GET_PATTERNS } from '../../app/api/proxy/medusa/[...path]/medusa-pii';
import { LAYOUT_GUARDED } from '../auth/layout-guarded';
import { importGraph } from '../auth/mutation-guard-graph';
import { resolveScreenAccess } from '../auth/screen-access';
import { hitsHead, piiPath, scanPiiApis } from './pii-api-scan';
import { PII_SCREEN_EXCEPTIONS } from './pii-screens.exceptions';
import {
  PII_SCREEN_NOT_SHOWN,
  PII_SCREENS,
  resolvePiiScreenIn,
  type PiiScreen,
  type PiiScreenTable,
} from './pii-screens';

/**
 * 개인정보를 응답하는 API 를 부르는 화면은 모두 `PII_SCREENS` 로 판정된다 — 표에 없으면 상시 안내가 뜨지 않는다.
 * 쓰기 라우트는 응답을 화면에 다시 그리지 않으므로 조회(GET)만 본다. 본문 없이 응답으로만 개인정보가 나가는
 * 직배송 인계 만들기는 조회와 같게 본다.
 */
const SRC = join(__dirname, '..', '..');
const READ_LIKE = new Set([
  'core POST /direct-ship/suppliers/:supplierId/handoffs',
]);

const backendPaths = PII_ROUTES.map((r) => r.split(' '))
  .filter(([, verb]) => verb === 'GET')
  .map(([, , path]) => path);
const readLikePaths = [...READ_LIKE].map((r) => r.split(' ')[2]);
const medusaPaths = MEDUSA_PII_GET_PATTERNS.map((r) => `/${r.pattern}`);
const PATHS = [...new Set([...backendPaths, ...readLikePaths, ...medusaPaths])]
  .sort()
  .map(piiPath);
const HEADS = new Set(PATHS.map((p) => p.head));

const pathOf = (route: string) => route.split(' ')[2];
/** [보기]로 원문을 다시 받는 경로 */
const REVEAL_PATHS = new Set([
  ...PII_REVEAL_ROUTES.map(pathOf),
  ...MEDUSA_PII_GET_PATTERNS.filter((r) => r.revealable).map(
    (r) => `/${r.pattern}`
  ),
]);
/** 선언한 필드가 모두 받는 분 정보 권한으로도 열리는 경로 */
const RECIPIENT_PATHS = new Set(PII_RECIPIENT_ROUTES.map(pathOf));

const graph = importGraph(SRC);
const { files } = graph;
const isApiFile = (rel: string) => /^lib\/(api|services)\//.test(rel);
const scan = scanPiiApis({
  graph,
  paths: PATHS,
  isApiFile,
  readLikePaths: new Set(readLikePaths),
  isException: (rel, head) =>
    Object.hasOwn(PII_SCREEN_EXCEPTIONS, `${rel} :: ${head}`),
});

const routeOf = (pageRel: string) =>
  '/' +
  pageRel
    .replace(/^app\//, '')
    .replace(/(^|\/)page\.tsx$/, '')
    .split('/')
    .filter((seg) => seg && !/^\(.*\)$/.test(seg))
    .join('/');

const entries = [
  ...[...files.keys()]
    .filter((rel) => /^app\/(.+\/)?page\.tsx$/.test(rel))
    .map((rel) => ({ rel, route: routeOf(rel) })),
  ...Object.entries(LAYOUT_GUARDED).map(([route, layout]) => ({
    rel: `app/${layout}`,
    route,
  })),
];
const ROUTES = new Set(entries.map((e) => e.route));

const flagged = entries
  .map((e) => ({ ...e, reached: scan.reachedFrom(e.rel) }))
  .filter((e) => e.reached.length > 0);
/** 안내 없음(`PII_SCREEN_NOT_SHOWN`)을 «판정됨»으로 구별하려고 null 자리에 표지를 넣은 표 */
const OPTED_OUT: PiiScreen = { opens: 'customer' };
const marked = (table: PiiScreenTable): PiiScreenTable =>
  Object.fromEntries(
    Object.entries(table).map(([k, v]) => [k, v ?? OPTED_OUT])
  );
const MARKED = marked(PII_SCREENS);
const sameScreen = (a: PiiScreen | null, b: PiiScreen | null) =>
  (a === OPTED_OUT) === (b === OPTED_OUT) &&
  a?.opens === b?.opens &&
  a?.reveal === b?.reveal &&
  a?.revealScope === b?.revealScope &&
  a?.recipientCoversAll === b?.recipientCoversAll;

/**
 * 닿는 경로로 정해지는 화면 표시 — 받는 분 경로가 있으면 recipient, 전부 받는 분 경로면 recipientCoversAll.
 * [보기] 경로와 그렇지 않은 경로를 함께 닿으면 [보기]는 상세만 연다(revealScope 'detail').
 */
const describeScreen = (s: PiiScreen) =>
  [
    s.opens,
    s.reveal ? 'reveal' : '',
    s.revealScope ? `scope:${s.revealScope}` : '',
    s.recipientCoversAll ? 'coversAll' : '',
  ]
    .filter(Boolean)
    .join('+');
const expectedScreen = (paths: ReadonlySet<string>): string => {
  const recipient = [...paths].filter((p) => RECIPIENT_PATHS.has(p));
  const others = [...paths].filter((p) => !RECIPIENT_PATHS.has(p));
  const revealable = [...paths].filter((p) => REVEAL_PATHS.has(p));
  return describeScreen({
    opens: recipient.length > 0 ? 'recipient' : 'customer',
    ...(revealable.length > 0 ? { reveal: true } : {}),
    ...(revealable.length > 0 && revealable.length < paths.size
      ? { revealScope: 'detail' }
      : {}),
    ...(recipient.length > 0 && others.length === 0
      ? { recipientCoversAll: true }
      : {}),
  });
};

const isDynamic = (seg: string) => seg.startsWith('[');
/** 페이지 경로의 고정 조각을 `[x]` 로 받는 키 — 다른 페이지(형제)의 키다 */
const coversSibling = (key: string, route: string) => {
  const k = key.split('/');
  const r = route.split('/');
  return (
    key !== route &&
    k.length === r.length &&
    k.every((seg, i) => (isDynamic(seg) ? true : seg === r[i])) &&
    k.some((seg, i) => isDynamic(seg) && !isDynamic(r[i]))
  );
};

describe('개인정보 화면 표시 게이트', () => {
  it('검사가 실제로 찾는다 — 빈 결과는 검사가 깨졌다는 뜻이다', () => {
    expect(scan.piiSymbols.size).toBeGreaterThan(10);
    expect(entries.length).toBeGreaterThan(100);
  });

  it('개인정보 API 에 닿는 화면은 모두 PII_SCREENS 로 판정되거나 사유와 함께 안내를 끈다', () => {
    const unmarked = flagged
      .filter((e) => resolvePiiScreenIn(MARKED, e.route) === null)
      .map((e) => `${e.route} ← ${e.reached.join(', ')}`)
      .sort();
    expect(unmarked).toEqual([]);
  });

  // 검사기 결과와 무관하게 표만 본다 — 검사기가 놓친 화면이 있어도 안내를 지우라고 요구하지 않는다.
  it('같은 깊이 [id] 키가 다른 고정 경로 페이지의 판정을 정하지 않는다', () => {
    const leaks = [...ROUTES].flatMap((r) =>
      Object.keys(MARKED)
        .filter((k) => coversSibling(k, r))
        .filter((k) => {
          const without = Object.fromEntries(
            Object.entries(MARKED).filter(([x]) => x !== k)
          );
          return !sameScreen(
            resolvePiiScreenIn(MARKED, r),
            resolvePiiScreenIn(without, r)
          );
        })
        .map((k) => `${r} ← ${k}`)
    );
    expect(leaks.sort()).toEqual([]);
  });

  it('PII_SCREENS 의 키는 실제 화면 경로이고, 빼면 어떤 화면의 판정이 바뀐다', () => {
    const dead = Object.keys(MARKED).filter((key) => {
      const real =
        [...ROUTES].some((r) => r === key || r.startsWith(`${key}/`)) &&
        resolveScreenAccess(key) !== undefined;
      if (!real) return true;
      const without = Object.fromEntries(
        Object.entries(MARKED).filter(([k]) => k !== key)
      );
      return [...ROUTES].every((r) =>
        sameScreen(
          resolvePiiScreenIn(MARKED, r),
          resolvePiiScreenIn(without, r)
        )
      );
    });
    expect(dead).toEqual([]);
  });

  // [보기]는 원문을 다시 받는 경로(받는 분 권한으로 이미 열리지 않는 것)에 닿을 때만 뜻이 있다. 받는 분 표시는
  // 받는 분 권한으로 열리는 경로에 닿는지·그것뿐인지로 정해진다(그 권한자에게 전부 원문이면 안내를 끈다).
  it('화면 표시(opens·reveal·revealScope·recipientCoversAll)가 그 화면이 닿는 개인정보 경로와 맞는다', () => {
    // 같은 경로의 페이지와 레이아웃이 함께 그린다
    const reach = new Map<string, Set<string>>();
    for (const e of entries)
      reach.set(
        e.route,
        new Set([...(reach.get(e.route) ?? []), ...scan.pathsFrom(e.rel)])
      );
    const wrong = [...reach]
      .map(([route, paths]) => ({
        route,
        paths,
        screen: resolvePiiScreenIn(MARKED, route),
      }))
      .filter(
        (e): e is typeof e & { screen: PiiScreen } =>
          e.screen !== null && e.screen !== OPTED_OUT
      )
      .filter((e) => describeScreen(e.screen) !== expectedScreen(e.paths))
      .map(
        (e) =>
          `${e.route}: ${describeScreen(e.screen)} → ${expectedScreen(e.paths)} ← ${[...e.paths].sort().join(', ')}`
      );
    expect(wrong.sort()).toEqual([]);
  });

  it('안내를 끄는 화면에는 사유가 있다', () => {
    expect(
      Object.entries(PII_SCREEN_NOT_SHOWN).filter(
        ([, reason]) => !reason.trim()
      )
    ).toEqual([]);
  });

  it('예외는 실제 파일과 그 파일이 실제로 부르는 경로 머리를 가리키고 사유가 있다', () => {
    const dead = Object.entries(PII_SCREEN_EXCEPTIONS)
      .filter(([key, reason]) => {
        const [rel, head] = key.split(' :: ');
        const source = files.get(rel);
        if (!reason.trim() || !HEADS.has(head) || source === undefined)
          return true;
        return isApiFile(rel)
          ? !hitsHead(source, head)
          : !scan.headsOfUi(rel).has(head);
      })
      .map(([key]) => key);
    expect(dead).toEqual([]);
  });
});
