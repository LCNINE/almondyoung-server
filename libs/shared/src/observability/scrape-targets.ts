/**
 * 관측 스크레이프 대상의 «정본 표».
 *
 * `config.alloy` · 가드 스펙 · (앞으로) 침묵 감시 알림(#708)의 job 정규식이 전부 여기서 나온다.
 * 대상을 늘리거나 줄이면 **여기만** 고칠 것. `scrape-targets.spec.ts` 가 config.alloy 와
 * 앱 소스 양쪽에 대해 이 표를 강제한다.
 *
 * 🔴 왜 표를 코드로 옮겼나 — 이 목록이 산문으로만 있던 동안 이슈 넷(#713·#708·#711·#704)이
 * 전부 「대상 9개」로 굳었다. #775(PR #787)가 열 번째로 `medusa` 를 더했는데 관측 축 밖의
 * PR 이라 어느 이슈도 따라오지 않았고, #708 이 제안한 알림 임계값 `< 9` 는 그대로 남았다 —
 * 즉 **Medusa 가 스크레이프에서 사라져도 그 알림은 울리지 않는다.** 같은 처방의 선례는
 * `scripts/local/e2e-env-map.sh` 다(그때는 문서 두 벌이 6/11 로 갈렸다).
 *
 * 표가 아니라 코드에서 도출해야 하는 값(계기 개수 등)은 여기 적지 않는다.
 */

/** 메트릭 서버를 어디서 띄우는가. */
export type MetricsServerKind =
  /** `libs/shared/src/observability/metrics-server.ts` — Nest 앱 9개 */
  | 'shared'
  /** 앱이 자체 사본을 갖는다 — Medusa 는 Nest 가 아니다 */
  | 'own';

/** Cloud Map DNS 접미사를 넘기는 env 이름. Alloy 가 서비스 이름 뒤에 붙여 조립한다. */
export type MetricsDnsSuffixEnv = 'METRICS_DNS_SUFFIX_SERVICES' | 'METRICS_DNS_SUFFIX_AUTH';

export interface ScrapeTarget {
  /** Prometheus `job` 라벨. `prometheus.relabel` 이 `service_name` 으로도 복사한다. */
  readonly job: string;
  /** `apps/<appDir>`. job 과 다를 수 있다 — `ugc-service` 는 job 이 `ugc` 다. */
  readonly appDir: string;
  /** 메트릭 서버의 출처. */
  readonly metricsServer: MetricsServerKind;
  /** `config.alloy` 의 `discovery.dns` 포트. 규칙은 «앱 포트 + 10000». */
  readonly metricsPort: number;
  /** SST 서비스 이름 = Cloud Map A 레코드의 앞부분. 번들 태스크는 여럿이 공유한다. */
  readonly serviceName: string;
  /** 그 서비스 이름 뒤에 붙는 접미사의 출처. user-service 만 별도 배포(lcnine-auth)다. */
  readonly dnsSuffixEnv: MetricsDnsSuffixEnv;
}

/**
 * 스크레이프 대상 전량. 순서는 `config.alloy` 의 블록 순서를 따른다.
 *
 * ⚠️ `serviceName` 이 같은 행이 여럿인 것은 오타가 아니다 — 번들 태스크(ServicesBundleA/B)는
 * 한 IP 에 앱이 여러 개라 포트만 다르다. 그래서 `instance` 라벨은 서비스를 식별하지 못한다.
 * 패널·알림의 갈래는 반드시 `job` / `service_name` 으로 잡을 것.
 */
export const SCRAPE_TARGETS: readonly ScrapeTarget[] = [
  {
    job: 'core',
    appDir: 'core',
    metricsServer: 'shared',
    metricsPort: 13000,
    serviceName: 'Core',
    dnsSuffixEnv: 'METRICS_DNS_SUFFIX_SERVICES',
  },
  {
    job: 'wallet',
    appDir: 'wallet',
    metricsServer: 'shared',
    metricsPort: 13000,
    serviceName: 'Wallet',
    dnsSuffixEnv: 'METRICS_DNS_SUFFIX_SERVICES',
  },
  {
    job: 'analytics',
    appDir: 'analytics',
    metricsServer: 'shared',
    metricsPort: 13040,
    serviceName: 'ServicesBundleA',
    dnsSuffixEnv: 'METRICS_DNS_SUFFIX_SERVICES',
  },
  {
    job: 'channel-adapter',
    appDir: 'channel-adapter',
    metricsServer: 'shared',
    metricsPort: 13001,
    serviceName: 'ServicesBundleA',
    dnsSuffixEnv: 'METRICS_DNS_SUFFIX_SERVICES',
  },
  {
    job: 'membership',
    appDir: 'membership',
    metricsServer: 'shared',
    metricsPort: 13002,
    serviceName: 'ServicesBundleA',
    dnsSuffixEnv: 'METRICS_DNS_SUFFIX_SERVICES',
  },
  {
    job: 'notification',
    appDir: 'notification',
    metricsServer: 'shared',
    metricsPort: 13003,
    serviceName: 'ServicesBundleB',
    dnsSuffixEnv: 'METRICS_DNS_SUFFIX_SERVICES',
  },
  {
    job: 'search',
    appDir: 'search',
    metricsServer: 'shared',
    metricsPort: 13004,
    serviceName: 'ServicesBundleB',
    dnsSuffixEnv: 'METRICS_DNS_SUFFIX_SERVICES',
  },
  {
    job: 'ugc',
    appDir: 'ugc-service',
    metricsServer: 'shared',
    metricsPort: 13030,
    serviceName: 'ServicesBundleB',
    dnsSuffixEnv: 'METRICS_DNS_SUFFIX_SERVICES',
  },
  {
    job: 'user-service',
    appDir: 'user-service',
    metricsServer: 'shared',
    metricsPort: 13000,
    serviceName: 'UserService',
    dnsSuffixEnv: 'METRICS_DNS_SUFFIX_AUTH',
  },
  {
    job: 'medusa',
    appDir: 'medusa',
    metricsServer: 'own',
    metricsPort: 19000,
    serviceName: 'Medusa',
    dnsSuffixEnv: 'METRICS_DNS_SUFFIX_SERVICES',
  },
];

/**
 * 메트릭 서버를 «의도적으로» 띄우지 않는 앱.
 *
 * 이 목록이 있어야 가드가 양방향으로 성립한다 — 여기 있는 앱이 나중에 메트릭 서버를 켜면
 * 스펙이 «표로 옮기라» 고 실패한다. 그냥 빠져 있는 것과 일부러 뺀 것을 구별하는 장치다.
 */
export const UNSCRAPED_APPS: readonly { readonly appDir: string; readonly why: string }[] = [
  { appDir: 'file-service', why: '@app/events 미사용 — DLQ·outbox 계기가 아예 없다' },
  { appDir: 'admin-web', why: 'Next.js. VPC 밖 Lambda 라 Alloy 가 닿지 않는다 (OTLP 게이트웨이 직행)' },
  { appDir: 'wallet-web', why: 'Next.js. 위와 같다' },
];

/** 스크레이프 대상 수. 알림 임계값을 손으로 적지 말고 이 값을 쓸 것. */
export const SCRAPE_TARGET_COUNT = SCRAPE_TARGETS.length;

/** PromQL `job=~"..."` 에 넣을 정규식 본문. */
export function metricsJobRegex(): string {
  return SCRAPE_TARGETS.map((t) => t.job).join('|');
}

/**
 * 침묵 감시 알림(#708 2번)의 PromQL.
 *
 * 🔴 `count(up) by (job) < N` 이 아니다 — 그건 job 마다 target 수(=1)를 N 과 비교하므로
 * **항상 발동**한다. job 의 «개수» 를 세려면 집계가 한 겹 더 필요하다.
 *
 * 🔴 그리고 전 job 이 사라지면 이 식은 빈 벡터라 `Firing` 이 아니라 `No Data` 다. 규칙에
 * **No data → Alerting** 을 반드시 걸 것. 그게 싫으면 job 별 `absent(up{job="…"})` 를 쓴다
 * (NoData 설정이 필요 없고 어느 job 인지도 알려주지만 규칙을 N 개 관리해야 한다).
 */
export function scrapeTargetSilenceQuery(): string {
  return `count(count by (job) (up{job=~"${metricsJobRegex()}"})) < ${SCRAPE_TARGET_COUNT}`;
}
