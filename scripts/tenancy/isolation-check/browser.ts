import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import type { ScreenVisit, SeenText } from './screen-judge';
import type { ScreenAccount } from './target';

/**
 * 화면 실측의 브라우저 — 판정하지 않고 «본 것»만 모은다(판정은 `screen-judge.ts`).
 *
 * playwright-core 로 이 머신의 Chrome 을 띄운다(브라우저를 내려받지 않는다). 다른 Chrome 을 쓰려면 `ISOLATION_CHECK_CHROME` 에
 * 실행 파일 경로를 둔다. 계정 하나 = 컨텍스트 하나(쿠키가 섞이지 않는다).
 */
export class ChromeUnavailable extends Error {}

/** 페이지 하나가 그린 것 — 판정용 `ScreenVisit` 에 파비콘 링크를 더한다. */
export interface PageCapture extends ScreenVisit {
  /** `<link rel=icon …>` 의 href. 비면 브라우저가 기본 `/favicon.ico` 를 스스로 부른다 */
  readonly icons: readonly string[];
}

const PAGE_TIMEOUT_MS = 90_000;
const SETTLE_MS = 15_000;

export async function launchChrome(): Promise<Browser> {
  const executablePath = process.env.ISOLATION_CHECK_CHROME;
  try {
    return await chromium.launch(executablePath ? { executablePath } : { channel: 'chrome' });
  } catch (e) {
    throw new ChromeUnavailable(
      `Chrome 을 못 띄웠다 — Chrome 을 설치하거나 ISOLATION_CHECK_CHROME 에 실행 파일 경로를 둔다 (${e instanceof Error ? e.message.split('\n')[0] : String(e)})`,
    );
  }
}

/** 한 계정의 브라우저 — 이 컨텍스트가 낸 요청·문서 이동 주소·본 글자를 쌓는다. */
export class ScreenSession {
  /** 모든 요청 주소(문서·스크립트·이미지·fetch …) */
  readonly requests: string[] = [];
  /** 최상위 문서가 거친 주소 전부 — 리디렉트 중간 주소와 클라이언트 이동(router.replace·pushState) 포함 */
  readonly navigations: string[] = [];
  /** 실측이 직접 친 주소 — «리디렉트 주소»는 앱이 보낸 곳이라 이건 뺀다(목록 밖 대표 경로 이름에 금지어가 있을 수 있다) */
  readonly typed = new Set<string>();
  /** 그린 글자 — 탭 제목·보이는 글자·파비콘 href, 어느 화면에서 나왔는지와 함께 */
  readonly seen: SeenText[] = [];
  readonly captures: PageCapture[] = [];

  private constructor(
    private readonly context: BrowserContext,
    private readonly page: Page,
  ) {
    context.on('request', (request) => {
      this.requests.push(request.url());
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) this.navigations.push(request.url());
    });
    // 같은 문서 안의 이동은 요청이 없다 — 프레임 이동으로 잡는다(요청으로 잡힌 주소와 겹치면 하나만).
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame() && this.navigations.at(-1) !== frame.url()) this.navigations.push(frame.url());
    });
  }

  /** 앱이 보낸 문서 이동(리디렉트·클라이언트 이동) — 실측이 친 주소는 뺀다 */
  redirects(): string[] {
    return this.navigations.filter((u) => !this.typed.has(u));
  }

  static async open(browser: Browser): Promise<ScreenSession> {
    const context = await browser.newContext({ locale: 'ko-KR' });
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_TIMEOUT_MS);
    return new ScreenSession(context, page);
  }

  async close(): Promise<void> {
    await this.context.close();
  }

  /**
   * 그 주소의 `/login` 에서 시작해 auth-web 로그인 화면으로 로그인한다. 로그인 화면도 «보이는 화면»이라 본 글자에 쌓는다.
   * 끝난 곳(admin-web 의 첫 화면, 거절 화면, 오류 문구가 뜬 로그인 화면)을 돌려준다 — 판정은 부르는 쪽이 한다.
   */
  async signIn(adminOrigin: string, account: ScreenAccount): Promise<{ landed: PageCapture; error: string | null }> {
    const adminHost = new URL(adminOrigin).host;
    this.typed.add(`${adminOrigin}/login`);
    await this.page.goto(`${adminOrigin}/login`, { waitUntil: 'load' });
    // auth-web 은 저장된 계정 목록(첫 화면)부터 보인다 — 거기서 «로그인» 으로 로그인 폼에 간다. 그 화면도 본 것에 쌓는다.
    const password = this.page.locator('input[name="password"]');
    const toSignIn = this.page.locator('a[href^="/signin"]').first();
    await password.or(toSignIn).waitFor({ state: 'visible' });
    if (!(await password.isVisible())) {
      await this.settle();
      await this.capture(new URL(this.page.url()).pathname, null);
      await toSignIn.click();
      await password.waitFor({ state: 'visible' });
    }
    await this.settle();
    await this.capture(new URL(this.page.url()).pathname, null);
    const loginInput = this.page.locator('input#loginId');
    if (await loginInput.isVisible()) await loginInput.fill(account.loginId);
    await this.page.locator('input[name="password"]').fill(account.password);
    await this.page.locator('form button[type="submit"]').click();
    const alert = this.page.locator('[role="alert"]');
    await Promise.race([
      this.page.waitForURL((u) => u.host === adminHost && !u.pathname.startsWith('/auth/'), {
        waitUntil: 'load',
      }),
      alert.filter({ hasText: /\S/ }).waitFor({ state: 'visible' }),
    ]);
    await this.settle();
    const error = new URL(this.page.url()).host === adminHost ? null : (await alert.innerText()).trim() || null;
    return { landed: await this.capture(new URL(this.page.url()).pathname, null), error };
  }

  /** 경로 하나를 연다. 리디렉트를 따라간 끝 문서의 상태와 그린 것을 돌려준다. */
  async visit(origin: string, path: string): Promise<PageCapture> {
    this.typed.add(`${origin}${path}`);
    const response = await this.page.goto(`${origin}${path}`, { waitUntil: 'load' });
    await this.settle();
    return this.capture(path, response?.status() ?? null);
  }

  /** 클라이언트가 데이터를 다 부를 때까지 — 끝내 조용해지지 않아도(폴링) 거기서 잰다. */
  private async settle(): Promise<void> {
    await this.page.waitForLoadState('networkidle', { timeout: SETTLE_MS }).catch(() => undefined);
  }

  private async capture(path: string, status: number | null): Promise<PageCapture> {
    const where = new URL(this.page.url()).host + path;
    const title = await this.page.title();
    const text = await this.page.locator('body').innerText();
    const icons = await this.page.$$eval('link[rel~="icon"], link[rel="apple-touch-icon"]', (links) =>
      links.map((l) => l.getAttribute('href') ?? ''),
    );
    this.seen.push(
      { where: `${where} 탭 제목`, text: title },
      { where: `${where} 보이는 글자`, text },
      ...icons.map((href) => ({ where: `${where} 파비콘`, text: href })),
    );
    const captured: PageCapture = { path, status, finalUrl: this.page.url(), title, text, icons };
    this.captures.push(captured);
    return captured;
  }
}
