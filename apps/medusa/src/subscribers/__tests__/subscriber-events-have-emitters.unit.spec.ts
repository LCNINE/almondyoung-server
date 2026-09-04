import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 가드 B (#775, ADR-0035): **subscriber 가 듣는 이벤트는 누군가 emit 한다.**
 *
 * 2026-09 에 같은 실패 모드가 셋 있었다 — 구독자는 있는데 발행자가 없다. 각 층의 테스트는 전부 초록이었다.
 * 깨진 곳이 층 사이라서다. 이 스펙은 그 사이를 본다: `src/subscribers/*.ts` 의 `config.event` 가
 * **Medusa 코어 이벤트 상수**(`@medusajs/utils` `core-flows/events.js`) 안에 있어야 한다. 우리 소스가 emit 하는
 * 커스텀 이벤트는 오늘 0개라(전수 grep) 그 집합으로 충분하다 — 생기면 여기에 `emitEventStep` 스캔을 더한다.
 *
 * 예외는 `KNOWN_DEAD` 뿐이고 **이슈 번호가 필수**다. 그 이슈가 닫히면 항목을 지운다 — 안 지우면 «stale» 로 빨개진다.
 */
const KNOWN_DEAD: Record<string, string> = {
  // Medusa 는 Kafka 를 소비하지 않는다 — user.updated.ts · user.deleted.ts 가 기다리는 이 이름을 내는 곳이 없다.
  'users.events.v1': '#786',
};

const SUBSCRIBERS_DIR = path.join(__dirname, '..');

function coreEventNames(): Set<string> {
  // `@medusajs/utils` 의 package.json#exports 는 "." 하나만 노출하므로
  // require.resolve('@medusajs/utils/package.json') 은 ERR_PACKAGE_PATH_NOT_EXPORTED 로 막힌다
  // (node -e 로도, jest 로도 재현됨). 대신 메인 엔트리(dist/index.js)를 resolve 해서 패키지 루트를 역산한다.
  const pkgMain = require.resolve('@medusajs/utils');
  const pkgRoot = path.join(path.dirname(pkgMain), '..');
  const source = readFileSync(path.join(pkgRoot, 'dist/core-flows/events.js'), 'utf8');
  return new Set([...source.matchAll(/"([a-z_-]+\.[a-z_]+)"/g)].map((m) => m[1]));
}

function subscriberFiles(): string[] {
  return readdirSync(SUBSCRIBERS_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
    .sort();
}

function subscribedEvents(file: string): string[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- 설정 객체만 읽는다
  const mod = require(path.join(SUBSCRIBERS_DIR, file)) as { config?: { event?: string | string[] } };
  const event = mod.config?.event;
  if (!event) throw new Error(`${file}: export const config 에 event 가 없다`);
  return Array.isArray(event) ? event : [event];
}

describe('가드 B — subscriber 가 듣는 이벤트는 코어가 emit 한다', () => {
  const core = coreEventNames();

  it('코어 상수를 읽었다 (경로가 바뀌면 여기가 먼저 빨개진다)', () => {
    expect(core.has('customer.created')).toBe(true);
    expect(core.has('order.placed')).toBe(true);
  });

  for (const file of subscriberFiles()) {
    it(`${file}`, () => {
      const dead = subscribedEvents(file).filter((e) => !core.has(e) && !(e in KNOWN_DEAD));
      expect(dead).toEqual([]);
    });
  }

  it('KNOWN_DEAD 의 값은 이슈 번호이고, 키는 아직 실제로 구독되고 있다', () => {
    const subscribed = new Set(subscriberFiles().flatMap(subscribedEvents));
    for (const [event, issue] of Object.entries(KNOWN_DEAD)) {
      expect(issue).toMatch(/^#\d+$/);
      expect(subscribed.has(event)).toBe(true); // stale 항목 — 고쳤으면 지울 것
    }
  });
});
