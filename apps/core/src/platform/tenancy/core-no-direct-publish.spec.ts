import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * core 는 Kafka 로 직접 발행하지 않는다 — 전부 outbox(`enqueue`) 로 낸다 (`core-no-direct-publish.spec` 의 규칙).
 *
 * core 의 봉투 테넌트는 «outbox 행이 든 DB» 로 정해진다. 직접 발행은 그 규칙 밖이라 맥락을 잘못 읽으면 남의 테넌트로
 * 나가고, 트랜잭션과도 묶이지 않는다(롤백돼도 메시지는 나간다). 그래서 예외를 두지 않고 호출 0 을 지킨다.
 */
const DIRECT_PUBLISH = /\.(publishEvent|publishEvents|publishCommand)\s*\(/;

function findDirectPublishCalls(files: readonly { path: string; content: string }[]): string[] {
  return files.flatMap(({ path, content }) =>
    content
      .split('\n')
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => DIRECT_PUBLISH.test(line) && !/^\s*(\/\/|\*)/.test(line))
      .map(({ index }) => `${path}:${index + 1}`),
  );
}

const ROOT = join(__dirname, '../../../../..');

function coreSources() {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', 'apps/core/src'], { cwd: ROOT }).toString();
  return out
    .split('\n')
    .filter((path) => path.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(path) && !path.includes('__fixtures__'))
    .map((path) => ({ path, content: readFileSync(join(ROOT, path), 'utf-8') }));
}

describe('core 의 직접 발행 0', () => {
  it('픽스처: publishEvent·publishEvents·publishCommand 호출을 잡는다', () => {
    expect(
      findDirectPublishCalls([
        { path: 'a.ts', content: 'await this.publisher.publishEvent({});\nawait p.publishCommand ({});' },
        { path: 'b.ts', content: 'await this.publisher.publishEvents([]);' },
      ]),
    ).toEqual(['a.ts:1', 'a.ts:2', 'b.ts:1']);
  });

  it('픽스처: enqueue 와 주석은 잡지 않는다', () => {
    expect(
      findDirectPublishCalls([
        {
          path: 'a.ts',
          content: 'await this.publisher.enqueue({}, tx);\n// .publishEvent( 를 쓰지 말 것\n * .publishEvent(',
        },
      ]),
    ).toEqual([]);
  });

  it('apps/core/src 에 직접 발행 호출이 없다 — outbox(enqueue) 로 옮길 것', () => {
    expect(findDirectPublishCalls(coreSources())).toEqual([]);
  });

  it('core 루트 모듈이 outbox 테넌트(접속 DB 의 테넌트)를 준다 — 빠지면 core 이벤트가 테넌트 없이 나간다', () => {
    expect(readFileSync(join(ROOT, 'apps/core/src/app.module.ts'), 'utf-8')).toMatch(/\bCoreOutboxTenantModule\b/);
  });
});
