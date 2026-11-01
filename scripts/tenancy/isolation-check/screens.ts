import * as tls from 'node:tls';
import { SCREEN_ACCESS } from '../../../apps/admin-web/src/lib/auth/screen-access';
import {
  TENANT_SHELL_MENU,
  TENANT_SHELL_SCREENS,
  tenantShellScreenOf,
} from '../../../apps/admin-web/src/lib/tenant-shell/allowlist';
import type { Browser } from 'playwright-core';
import { ChromeUnavailable, launchChrome, ScreenSession, type PageCapture } from './browser';
import { expectOk } from './http';
import { fail, pass, skip, type Skipped, type Verdict } from './judge';
import type { IsolationCheck } from './runner';
import {
  concretePath,
  crossRefusal,
  forbiddenHits,
  foreignSanNames,
  notFoundProblem,
  offListRequests,
  openProblem,
  outsidePaths,
  tenantOneUpstreamCalls,
} from './screen-judge';
import type { IsolationTarget, ScreenAccount } from './target';

const FIXED_BY = {
  shell:
    '비공개 지도 20 — admin-web 테넌트 셸(apps/admin-web/src/lib/tenant-shell/allowlist.ts 의 허용 목록, middleware.ts 의 목록 밖 404)',
  login: '비공개 지도 19 — auth-web 테넌트 도메인 로그인(web/auth-web/lib/site), 점검 계정은 만들기 스크립트',
  trace:
    '비공개 지도 19·20 — 브랜드(두 앱 루트 레이아웃의 generateMetadata)·셸 문구. 금지어 목록은 로컬 ' +
    '.local-e2e/isolation-check/forbidden-words.txt, 라이브 Secret IsolationCheck 의 forbiddenWords',
  network:
    '비공개 지도 19·20 — 화면이 테넌트 도메인 밖을 부른다(절대 URL·외부 스크립트). 이미지면 file-service 버킷(지도 14)',
  hidden:
    '비공개 지도 22 — 셸이 «못 쓰는 업스트림»을 알리면 숨는 블록(useUpstreamAvailable). 새 블록이면 tenant-shell.gate.spec 의 HIDDEN_BLOCKS',
  certificate: '비공개 지도 18 — 테넌트 도메인 CloudFront 칸의 인증서(테넌트 도메인만 싣는다)',
  cross:
    '비공개 지도 05·19·20 — 등록 리디렉트 host → 토큰 테넌트, 토큰 테넌트에서 받은 부여만, 셸의 admitsToken(middleware.ts)',
} as const;

/** 주소 교차에서 «열리면 안 되는» 화면 — 테넌트 셸 메뉴의 첫 화면(테넌트 2 점검 계정이 자기 주소에서 여는 곳). */
const CROSS_PROBE = TENANT_SHELL_MENU[0].items[0].path;
const SECTION = '화면';
const CROSS = '주소 교차';

/** 주소 교차 한 번 — 그 계정으로 그 주소에 로그인한 뒤 CROSS_PROBE 를 연 결과. */
interface CrossAttempt {
  readonly session: ScreenSession;
  readonly loginError: string | null;
  readonly capture: PageCapture;
}

interface Tour {
  readonly session: ScreenSession;
  readonly landing: PageCapture;
  readonly loginError: string | null;
  readonly opened: { readonly screen: string; readonly capture: PageCapture }[];
  /** 잴 행이 없어 못 연 동적 화면 */
  readonly noRows: string[];
  readonly outside: PageCapture[];
  /** 아몬드영 계정이 테넌트 2 주소에 들어온 결과 — 그 거절 화면도 테넌트 2 직원이 볼 수 있는 화면이라 흔적·네트워크로 잰다 */
  readonly tenantOneAtTenantTwo: CrossAttempt;
}

/** 목록을 그대로 늘어놓되 너무 길면 자르고, 몇 건을 잘랐는지 적는다. */
function listed(items: readonly string[], max = 8): string {
  const head = items.slice(0, max).join(' · ');
  return items.length > max ? `${head} · 외 ${items.length - max}건` : head;
}

/**
 * 화면 실측 — 헤드리스 Chrome 으로 테넌트 도메인에 테넌트 2 점검 계정으로 로그인해 허용 목록 전부와 목록 밖 대표 경로를
 * 한 번 돈다(«투어»). 화면 항목들은 그 투어가 본 것을 판정한다. 주소 교차는 계정마다 새 브라우저 컨텍스트다.
 * JS 번들 안 문자열은 기준 밖이다(비공개 spec «흔적 0» 기준선) — 그래서 응답 본문이 아니라 그려진 것과 요청 주소를 본다.
 */
export function buildScreenChecks(
  t: IsolationTarget,
  tenantTwoToken: () => Promise<string>,
): { checks: IsolationCheck<void>[]; close: () => Promise<void> } {
  const s = t.screens;
  const tenantOneAdmin = t.urls.adminWeb;
  let browser: Browser | null = null;
  const sessions: ScreenSession[] = [];
  const newSession = async () => {
    browser ??= await launchChrome();
    const session = await ScreenSession.open(browser);
    sessions.push(session);
    return session;
  };

  /**
   * 동적 화면을 채울 테넌트 2 의 행. 상품은 게시된 것만 — 상세의 매칭 열(숨겨야 하는 블록)은 게시된 상품에서만 뜨므로, 초안으로
   * 열면 «업스트림 요청 0» 이 그 블록을 안 그리고 초록이 된다. 없으면 그 화면은 «행이 없다».
   */
  const sampleIds = async (): Promise<Record<string, string>> => {
    const bearer = await tenantTwoToken();
    const masters = (await expectOk('GET', `${t.urls.core}/masters?mode=all&limit=100`, { bearer })) as {
      data?: { masterId?: string; status?: string }[];
    };
    const rows = masters.data ?? [];
    const master = rows.find((r) => r.status === 'active');
    const sessionsBody = (await expectOk('GET', `${t.urls.core}/product-bulk-sessions?limit=1`, { bearer })) as {
      data?: { id?: string }[];
    };
    const ids: Record<string, string> = {};
    if (master?.masterId) ids.masterId = master.masterId;
    const bulk = sessionsBody.data?.[0]?.id;
    if (bulk) ids.id = bulk;
    return ids;
  };

  const attempt = async (origin: string, account: ScreenAccount): Promise<CrossAttempt> => {
    const session = await newSession();
    const { error } = await session.signIn(origin, account);
    return { session, loginError: error, capture: await session.visit(origin, CROSS_PROBE) };
  };

  let tourRun: Promise<Tour> | null = null;
  const tour = () =>
    (tourRun ??= (async (): Promise<Tour> => {
      const session = await newSession();
      const { landed: signedIn, error } = await session.signIn(s.tenantTwoAdmin, s.accounts.tenantTwo);
      const landingPath = new URL(signedIn.finalUrl).pathname;
      const landing = error ? signedIn : await session.visit(s.tenantTwoAdmin, landingPath);
      const ids = await sampleIds();
      const opened: Tour['opened'] = [];
      const noRows: string[] = [];
      for (const screen of TENANT_SHELL_SCREENS) {
        const path = concretePath(screen, ids);
        if (!path) {
          noRows.push(screen);
          continue;
        }
        opened.push({ screen, capture: await session.visit(s.tenantTwoAdmin, path) });
      }
      const outside: PageCapture[] = [];
      for (const path of outsidePaths(Object.keys(SCREEN_ACCESS), TENANT_SHELL_SCREENS))
        outside.push(await session.visit(s.tenantTwoAdmin, path));
      const tenantOneAtTenantTwo = await attempt(s.tenantTwoAdmin, s.accounts.tenantOne);
      return { session, landing, loginError: error, opened, noRows, outside, tenantOneAtTenantTwo };
    })());

  /** 브라우저가 없으면 화면 항목 전부 «못 쟀다» — 로컬은 경고, 라이브는 실패다. */
  const withBrowser = async (run: () => Promise<Verdict | Skipped> | Verdict | Skipped) => {
    try {
      return await run();
    } catch (e) {
      if (e instanceof ChromeUnavailable) return skip(e.message);
      throw e;
    }
  };
  const withTour = (judge: (tour: Tour) => Promise<Verdict | Skipped> | Verdict | Skipped) =>
    withBrowser(async () => judge(await tour()));
  /** 테넌트 2 주소에서 그려진 화면 전부 — 투어와 아몬드영 계정의 거절 화면 */
  const tenantTwoSessions = (tour: Tour) => [tour.session, tour.tenantOneAtTenantTwo.session];

  const checks: IsolationCheck<void>[] = [];
  const add = (c: Omit<IsolationCheck<void>, 'part'>) => checks.push({ ...c, part: 'read' });

  add({
    section: SECTION,
    title: '테넌트 2 점검 계정이 테넌트 도메인의 로그인 화면으로 들어와 허용 목록 화면에 닿는다',
    fixedBy: FIXED_BY.login,
    run: () =>
      withTour(({ landing, loginError }) => {
        if (loginError) return fail(`로그인 화면이 «${loginError}»`);
        const url = new URL(landing.finalUrl);
        if (url.host !== new URL(s.tenantTwoAdmin).host) return fail(`로그인 뒤 ${landing.finalUrl} 로 갔다`);
        if (!tenantShellScreenOf(url.pathname)) return fail(`첫 화면 ${url.pathname} 이(가) 허용 목록 밖이다`);
        const problem = openProblem(landing);
        return problem ? fail(`첫 화면 ${url.pathname} — ${problem}`) : pass;
      }),
  });
  add({
    section: SECTION,
    title: `허용 목록 화면 ${TENANT_SHELL_SCREENS.length}개가 열린다`,
    fixedBy: FIXED_BY.shell,
    run: () =>
      withTour(({ opened, noRows }) => {
        const problems = opened.flatMap(({ screen, capture }) => {
          const p = openProblem(capture);
          return p ? [`${capture.path} — ${p}${capture.path === screen ? '' : ` (${screen})`}`] : [];
        });
        if (problems.length > 0) return fail(problems.join(' · '));
        if (noRows.length > 0)
          return skip(`${opened.length}개는 열렸다. 테넌트 2 에 행이 없어 못 연 화면: ${noRows.join(', ')}`);
        return pass;
      }),
  });
  add({
    section: SECTION,
    title: '목록 밖 대표 경로가 404 다',
    fixedBy: FIXED_BY.shell,
    run: () =>
      withTour(({ outside }) => {
        const problems = outside.flatMap((c) => {
          const p = notFoundProblem(c);
          return p ? [`${c.path} — ${p}`] : [];
        });
        return problems.length > 0 ? fail(problems.join(' · ')) : pass;
      }),
  });
  add({
    section: SECTION,
    title: '흔적 0 — 보이는 글자·탭 제목·파비콘 href 에 금지어가 없다',
    fixedBy: FIXED_BY.trace,
    run: () =>
      withTour(async (tour) => {
        const words = await s.forbiddenWords();
        if (!words) return skip('금지어 목록이 없다');
        const hits = [...new Set(tenantTwoSessions(tour).flatMap((x) => forbiddenHits(x.seen, words)))];
        return hits.length > 0 ? fail(listed(hits)) : pass;
      }),
  });
  add({
    section: SECTION,
    title: '파비콘 — 테넌트 2 화면마다 기본 /favicon.ico(아몬드영 아이콘)가 아닌 링크가 있다',
    fixedBy: FIXED_BY.trace,
    run: () =>
      withTour((tour) => {
        // 링크가 없으면 브라우저가 스스로 /favicon.ico 를 부른다 — 테넌트 도메인에서도 admin-web public/ 의 기본 아이콘이 나온다.
        const problems = tenantTwoSessions(tour).flatMap((x) =>
          x.captures.flatMap((c) => {
            const where = `${new URL(c.finalUrl).host}${c.path}`;
            if (c.icons.length === 0) return [`${where} 파비콘 링크 없음`];
            return c.icons.some((href) => href !== '' && new URL(href, c.finalUrl).pathname === '/favicon.ico')
              ? [`${where} 파비콘이 /favicon.ico`]
              : [];
          }),
        );
        return problems.length > 0 ? fail(listed([...new Set(problems)])) : pass;
      }),
  });
  add({
    section: SECTION,
    title: '흔적 0 — 리디렉트 주소가 테넌트 도메인을 벗어나지 않고 금지어가 없다',
    fixedBy: FIXED_BY.trace,
    run: () =>
      withTour(async (tour) => {
        const words = await s.forbiddenWords();
        if (!words) return skip('금지어 목록이 없다');
        const redirects = tenantTwoSessions(tour).flatMap((x) => x.redirects());
        const left = offListRequests(redirects, { hosts: await s.tenantTwoHosts(), prefixes: [] });
        const hits = forbiddenHits(
          redirects.map((u) => ({ where: `리디렉트 ${u.slice(0, 160)}`, text: u })),
          words,
        );
        const problems = [...left.map((l) => `테넌트 도메인 밖으로 이동: ${l}`), ...new Set(hits)];
        return problems.length > 0 ? fail(listed(problems)) : pass;
      }),
  });
  add({
    section: SECTION,
    title: '네트워크 호스트 = 테넌트 도메인 + 테넌트 2 버킷',
    fixedBy: FIXED_BY.network,
    run: () =>
      withTour(async (tour) => {
        const allowed = { hosts: await s.tenantTwoHosts(), prefixes: s.tenantTwoBucketPrefixes };
        const off = offListRequests(
          tenantTwoSessions(tour).flatMap((x) => x.requests),
          allowed,
        );
        return off.length > 0 ? fail(listed(off)) : pass;
      }),
  });
  add({
    section: SECTION,
    title: '테넌트 1 만 섬기는 업스트림 요청 0 (상품 목록·상세 포함)',
    fixedBy: FIXED_BY.hidden,
    run: () =>
      withTour(({ session }) => {
        const calls = tenantOneUpstreamCalls(session.requests);
        if (calls.length === 0) return pass;
        const paths = [...new Set(calls.map((u) => new URL(u).pathname))];
        return fail(`${calls.length}건 — ${listed(paths, 5)}`);
      }),
  });
  add({
    section: SECTION,
    title: '인증서 SAN 에 테넌트 도메인만',
    fixedBy: FIXED_BY.certificate,
    run: async () => {
      if (new URL(s.tenantTwoAdmin).protocol !== 'https:')
        return skip('테넌트 도메인이 http 다 — 인증서는 라이브(https)에서만 잰다');
      const hosts = await s.tenantTwoHosts();
      const names = hosts.map((h) => h.split(':')[0]);
      const words = (await s.forbiddenWords()) ?? [];
      const problems: string[] = [];
      for (const host of hosts) {
        const san = await peerSubjectAltName(host);
        problems.push(...foreignSanNames(san, names).map((n) => `${host} 인증서에 ${n}`));
        problems.push(...forbiddenHits([{ where: `${host} 인증서 SAN`, text: san }], words));
      }
      return problems.length > 0 ? fail(listed(problems)) : pass;
    },
  });

  // 주소 교차 — 대조가 먼저다: 같은 계정이 자기 주소에서는 그 화면을 연다(못 열면 «거절»이 아무것도 증명 못 한다).
  const crossVerdict = (a: CrossAttempt): Verdict => {
    const problem = crossRefusal(a.capture, a.loginError);
    return problem ? fail(problem) : pass;
  };
  add({
    section: CROSS,
    title: `테넌트 2 계정 → 아몬드영 관리자 주소: ${CROSS_PROBE} 가 거절된다`,
    fixedBy: FIXED_BY.cross,
    run: () =>
      withTour(async ({ opened }) => {
        const own = opened.find((o) => o.screen === CROSS_PROBE);
        if (!own || openProblem(own.capture)) return fail(`대조(자기 주소)에서도 ${CROSS_PROBE} 가 안 열린다`);
        return crossVerdict(await attempt(tenantOneAdmin, s.accounts.tenantTwo));
      }),
  });
  add({
    section: CROSS,
    title: `아몬드영 계정 → 테넌트 2 주소: ${CROSS_PROBE} 가 거절된다`,
    fixedBy: FIXED_BY.cross,
    run: () =>
      withTour(async ({ tenantOneAtTenantTwo }) => {
        const own = await attempt(tenantOneAdmin, s.accounts.tenantOne);
        const problem = openProblem(own.capture);
        if (problem) return fail(`대조(아몬드영 주소)에서도 ${CROSS_PROBE} 가 안 열린다 — ${problem}`);
        return crossVerdict(tenantOneAtTenantTwo);
      }),
  });

  return {
    checks,
    close: async () => {
      for (const session of sessions) await session.close().catch(() => undefined);
      await browser?.close();
    },
  };
}

/** `host[:port]` 의 TLS 인증서 SAN(«DNS:a, DNS:b»). 브라우저 인증서 정보에 보이는 그 목록이다. */
function peerSubjectAltName(host: string): Promise<string> {
  const [servername, port] = host.split(':');
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: servername, servername, port: Number(port ?? 443), timeout: 15_000 }, () => {
      const san = socket.getPeerCertificate().subjectaltname ?? '';
      socket.end();
      resolve(san);
    });
    socket.on('timeout', () => socket.destroy(new Error(`${host} TLS 접속 시간 초과`)));
    socket.on('error', reject);
  });
}
