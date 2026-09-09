import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  SCRAPE_TARGETS,
  SCRAPE_TARGET_COUNT,
  UNSCRAPED_APPS,
  metricsJobRegex,
  scrapeTargetSilenceQuery,
} from './scrape-targets';

/**
 * `scrape-targets.ts` 를 정본으로 강제하는 가드.
 *
 * 잡으려는 사고는 하나다 — **관측 축 «밖»의 PR 이 스크레이프 대상을 바꾸고 지나가는 것.**
 * #775 가 정확히 그랬다: 쿠폰 작업이 `config.alloy` 에 `medusa` job 을 열 번째로 더했는데,
 * 대상 수를 「9」로 적어 둔 이슈 넷도 그 수를 임계값으로 쓰는 알림 설계도 따라오지 않았다.
 * 표와 실물이 갈리면 여기서 빨개진다.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const ALLOY_CONFIG = join(REPO_ROOT, 'deployments/lcnine/services/observability/alloy/config.alloy');
const SHARED_METRICS_SERVER_IMPORT = 'startMetricsServer';

interface ParsedScrapeBlock {
  readonly job: string;
  readonly dnsLabel: string;
}

interface ParsedDnsBlock {
  readonly serviceName: string;
  readonly suffixEnv: string;
  readonly port: number;
}

function readAlloyConfig(): string {
  expect(existsSync(ALLOY_CONFIG)).toBe(true);
  return readFileSync(ALLOY_CONFIG, 'utf8');
}

/** `prometheus.scrape "<label>" { … }` 블록에서 job 이름과 참조하는 discovery.dns 라벨을 뽑는다. */
function parseScrapeBlocks(config: string): ParsedScrapeBlock[] {
  const blocks: ParsedScrapeBlock[] = [];
  const blockRe = /^prometheus\.scrape\s+"(\w+)"\s*\{\n([\s\S]*?)^\}/gm;

  for (let m = blockRe.exec(config); m !== null; m = blockRe.exec(config)) {
    const body = m[2];
    const job = /job_name\s*=\s*"([^"]+)"/.exec(body);
    const dnsLabel = /targets\s*=\s*discovery\.dns\.(\w+)\.targets/.exec(body);

    // 파싱 실패를 조용히 「대상 0개」로 넘기면 가드가 통과해 버린다 — 반드시 터뜨린다.
    expect(job).not.toBeNull();
    expect(dnsLabel).not.toBeNull();

    blocks.push({ job: job![1], dnsLabel: dnsLabel![1] });
  }

  return blocks;
}

/** `discovery.dns "<label>" { … }` 블록에서 서비스 이름·접미사 env·포트를 뽑는다. */
function parseDnsBlocks(config: string): Map<string, ParsedDnsBlock> {
  const blocks = new Map<string, ParsedDnsBlock>();
  const blockRe = /^discovery\.dns\s+"(\w+)"\s*\{\n([\s\S]*?)^\}/gm;

  for (let m = blockRe.exec(config); m !== null; m = blockRe.exec(config)) {
    const body = m[2];
    const names = /names\s*=\s*\["(\w+)\."\s*\+\s*sys\.env\("(\w+)"\)\]/.exec(body);
    const port = /port\s*=\s*(\d+)/.exec(body);

    expect(names).not.toBeNull();
    expect(port).not.toBeNull();

    blocks.set(m[1], {
      serviceName: names![1],
      suffixEnv: names![2],
      port: Number(port![1]),
    });
  }

  return blocks;
}

function startsMetricsServer(appDir: string): boolean {
  const candidates = [
    join(REPO_ROOT, 'apps', appDir, 'src', 'tracing.ts'),
    join(REPO_ROOT, 'apps', appDir, 'instrumentation.ts'),
  ];

  return candidates.some(
    (file) => existsSync(file) && readFileSync(file, 'utf8').includes(SHARED_METRICS_SERVER_IMPORT),
  );
}

describe('스크레이프 대상 정본 (scrape-targets.ts)', () => {
  describe('config.alloy 와 표가 일치한다', () => {
    it('job 집합이 양방향으로 같다', () => {
      const blocks = parseScrapeBlocks(readAlloyConfig());

      // 정렬해서 비교한다 — 블록 순서는 강제하지 않는다.
      expect(blocks.map((b) => b.job).sort()).toEqual(SCRAPE_TARGETS.map((t) => t.job).sort());
    });

    it('대상 수가 표와 같다 (알림 임계값의 근거)', () => {
      expect(parseScrapeBlocks(readAlloyConfig())).toHaveLength(SCRAPE_TARGET_COUNT);
    });

    it('job 마다 포트·서비스 이름·DNS 접미사 env 가 표와 같다', () => {
      const config = readAlloyConfig();
      const scrapeBlocks = parseScrapeBlocks(config);
      const dnsBlocks = parseDnsBlocks(config);

      for (const target of SCRAPE_TARGETS) {
        const scrape = scrapeBlocks.find((b) => b.job === target.job);
        expect(scrape).toBeDefined();

        const dns = dnsBlocks.get(scrape!.dnsLabel);
        expect(dns).toBeDefined();

        expect({ job: target.job, ...dns! }).toEqual({
          job: target.job,
          serviceName: target.serviceName,
          suffixEnv: target.dnsSuffixEnv,
          port: target.metricsPort,
        });
      }
    });
  });

  describe('앱 소스와 표가 일치한다', () => {
    it.each(SCRAPE_TARGETS.filter((t) => t.metricsServer === 'shared'))(
      '$appDir 은 공용 metrics-server 를 띄운다',
      ({ appDir }) => {
        const tracing = join(REPO_ROOT, 'apps', appDir, 'src', 'tracing.ts');

        expect(existsSync(tracing)).toBe(true);
        expect(readFileSync(tracing, 'utf8')).toContain('@app/shared/observability/metrics-server');
      },
    );

    it.each(SCRAPE_TARGETS.filter((t) => t.metricsServer === 'own'))(
      '$appDir 은 자체 metrics-server 사본을 갖고 그것을 부른다',
      ({ appDir }) => {
        const own = join(REPO_ROOT, 'apps', appDir, 'src', 'observability', 'metrics-server.ts');

        expect(existsSync(own)).toBe(true);
        expect(startsMetricsServer(appDir)).toBe(true);
      },
    );

    it.each(UNSCRAPED_APPS)('$appDir 은 메트릭 서버를 띄우지 않는다 (의도적 제외: $why)', ({ appDir }) => {
      // 켜기로 했다면 SCRAPE_TARGETS 와 config.alloy 로 «함께» 옮겨야 한다.
      expect(startsMetricsServer(appDir)).toBe(false);
    });

    it('apps/ 의 모든 앱이 «대상» 이거나 «의도적 제외» 다', () => {
      const appDirs = readdirSync(join(REPO_ROOT, 'apps'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();

      const accounted = [...SCRAPE_TARGETS.map((t) => t.appDir), ...UNSCRAPED_APPS.map((a) => a.appDir)].sort();

      // 새 앱을 만들면 여기서 실패한다 — 스크레이프할지 말지를 «결정하게» 만드는 장치다.
      expect(appDirs).toEqual(accounted);
    });
  });

  describe('알림 쿼리를 손으로 적지 않게 한다', () => {
    it('job 정규식이 대상 전부를 덮는다', () => {
      const regex = new RegExp(`^(?:${metricsJobRegex()})$`);

      for (const target of SCRAPE_TARGETS) {
        expect(regex.test(target.job)).toBe(true);
      }
    });

    it('침묵 감시 쿼리가 job 개수를 세고, 임계값이 대상 수와 같다', () => {
      const query = scrapeTargetSilenceQuery();

      // `count(up) by (job) < N` 은 job 당 target 수(=1)를 N 과 비교해 «항상» 발동한다.
      // 집계가 두 겹인지를 형태로 확인한다.
      expect(query).toContain('count(count by (job) (up{job=~"');
      expect(query).toContain(`)) < ${SCRAPE_TARGET_COUNT}`);
      expect(query).not.toMatch(/^count\(up\)\s+by\s+\(job\)/);
    });
  });
});
