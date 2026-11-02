/**
 * 격리 실측이 재는 «대상» — 로컬 E2E 와 라이브가 같은 점검(`checks.ts`)을 돌고, 대상만 갈아 끼운다.
 * 테스트와 운영 점검이 갈라지지 않게 하는 이음매다. 라이브 값(점검 계정 비밀번호 등)은 SST Secret 에서만 온다.
 */

/** 1단계에서 테넌트 1 만 섬기는 공유 서비스(비공개 ADR 0005). */
export type SharedServiceName =
  | 'wallet'
  | 'membership'
  | 'analytics'
  | 'ugc-service'
  | 'notification'
  | 'search'
  | 'channel-adapter';

/**
 * 서비스마다 대표 라우트 하나 — 토큰 입구(`@RequirePermission`·`@StoreRoute`)의 GET 이다. 문이 권한보다 «먼저» 판정하므로
 * 테넌트 2 역할에 그 권한이 없어도 문의 거절 문구가 나와야 한다. 테넌트 1 토큰은 같은 경로에서 2xx 여야 한다(대조) —
 * 경로가 썩으면 거기서 빨개진다.
 */
export const SHARED_SERVICE_PROBES: Readonly<Record<SharedServiceName, string>> = {
  wallet: '/v1/admin/payment-methods',
  membership: '/subscriptions/current',
  analytics: '/statistics/operating-costs',
  'ugc-service': '/reviews/admin/rewards/rules',
  notification: '/logs/stats',
  // from·to 가 필수다(없으면 대조가 400). 하루 창이면 충분하다 — 판정은 상태·문구만 본다.
  search: '/search/admin/keywords/statistics?from=2026-01-01&to=2026-01-01',
  'channel-adapter': '/adapter/order-reconcile-findings',
};

export interface CronObservation {
  /** 테넌트 1 core DB 에서 최근 `windowMinutes` 안에 선점된 크론 이름 수 — 0 이면 대조가 무의미하다 */
  readonly tenantOneRecent: number;
  /** 그중 테넌트 2 core DB 에 최근 선점 행이 없는 크론 — 테넌트별로 안 돈다 */
  readonly missingInTenantTwo: readonly string[];
  readonly windowMinutes: number;
}

/** 화면 실측이 로그인하는 계정 — 화면(auth-web 로그인 폼)으로 들어간다. */
export interface ScreenAccount {
  readonly loginId: string;
  readonly password: string;
}

/** 화면 실측(브라우저) 쪽 — `screens.ts`. */
export interface ScreenTarget {
  /** 테넌트 2 admin-web 의 기원(테넌트 도메인). 테넌트 1 은 `urls.adminWeb` */
  readonly tenantTwoAdmin: string;
  readonly accounts: { readonly tenantOne: ScreenAccount; readonly tenantTwo: ScreenAccount };
  /** 테넌트 2 의 테넌트 도메인 전부(호스트:포트) — user-service 가 들고 있는 값을 그대로 읽는다 */
  readonly tenantTwoHosts: () => Promise<readonly string[]>;
  /** 테넌트 2 버킷의 URL 접두사(공개·비공개). 브라우저가 닿아도 되는 테넌트 도메인 밖의 유일한 곳 */
  readonly tenantTwoBucketPrefixes: readonly string[];
  /** «흔적 0» 의 금지어 — 비공개 값이라 레포 밖(로컬 파일·라이브 Secret)에서 읽는다. 없으면 null(못 잰다) */
  readonly forbiddenWords: () => Promise<readonly string[] | null>;
}

/** 앱 이름 → 그 앱 `/metrics` 의 합. 못 읽은 앱은 키가 없다 — 비교는 두 번 다 읽힌 앱끼리만 한다. */
export interface ConsumerMetrics {
  /** 소비 앱마다 `events_skipped_other_tenant_total` */
  readonly skippedOtherTenant: Readonly<Record<string, number>>;
  /** 앱마다 `events_dlq_messages_total` */
  readonly deadLettered: Readonly<Record<string, number>>;
  /**
   * 앱마다 값이 나온 수집의 시각(epoch ms). 로컬은 `/metrics` 를 직접 읽어 «지금»이고, 라이브는 원격 저장소의 마지막 샘플이라
   * 스크레이프 주기 + 원격 쓰기 지연만큼 늦다 — «0» 을 믿으려면 이 시각이 기준보다 뒤여야 한다(`judge.noNewDeadLetters`).
   */
  readonly scrapedAt: Readonly<Record<string, number>>;
  /** 메트릭을 못 읽은 앱. 라이브는 스크레이프 대상 전부, 로컬은 소비 앱만(file-service 는 메트릭 서버를 안 띄운다) */
  readonly unreachable: readonly string[];
}

export interface IsolationTarget {
  readonly label: string;
  /** 건너뜀을 실패로 센다(라이브) */
  readonly strict: boolean;
  readonly tenantOneId: string;
  readonly tenantTwoId: string;
  readonly urls: {
    readonly core: string;
    readonly fileService: string;
    /** Medusa 스토어 API(쇼핑몰이 부르는 곳) */
    readonly medusa: string;
    /** 테넌트 1 admin-web. API 라우트는 주소와 무관하게 토큰 테넌트로 판정한다 */
    readonly adminWeb: string;
  };
  /** url null = 이 대상에 그 서비스가 없다(로컬의 extra 앱) */
  readonly sharedServices: readonly { readonly name: SharedServiceName; readonly url: string | null }[];
  /** 부를 때마다 새로 로그인한다. 거절되면 `TokenRefused` 를 던진다 */
  readonly signIn: { readonly tenantOne: () => Promise<string>; readonly tenantTwo: () => Promise<string> };
  /** 쇼핑몰 클라이언트로 받은 고객 토큰 */
  readonly customerToken: () => Promise<string>;
  readonly storePublishableKey: string;
  /** 테넌트 1 의 디지털 상품 파일 id 하나(없으면 null) */
  readonly tenantOneDigitalFileId: () => Promise<string | null>;
  /** 테넌트 2 core DB 의 `cron_runs` */
  readonly tenantTwoCronRuns: () => Promise<CronObservation>;
  readonly screens: ScreenTarget;
  /** 쓰기 부분에서만 — 없으면 그 대상은 쓰기 부분을 못 돈다 */
  readonly write?: {
    readonly consumerMetrics: () => Promise<ConsumerMetrics>;
    /** 일어난 일이 `consumerMetrics` 에 보이기까지의 최대 지연 — 로컬 0, 라이브는 스크레이프 주기 + 원격 쓰기 */
    readonly metricsLagMs: number;
    readonly setTenantStatus: (tenantId: string, status: 'active' | 'suspended') => Promise<void>;
    /** 직원 역할로 못 지우는 것(상품)을 치운다. 못 지운 것의 설명을 돌려준다(실행 끝에 출력). 없으면 전부 남는다 */
    readonly removeProducts?: (masterIds: readonly string[]) => Promise<string[]>;
  };
}
