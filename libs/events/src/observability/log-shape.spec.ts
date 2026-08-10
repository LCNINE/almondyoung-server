/**
 * 진단 로그가 **구조화 필드를 잃지 않는지** 봉인한다 (플랜 Task 5-C 관측 결정).
 *
 * ## 왜 이 스펙인가
 *
 * 5-C 는 core 를 제외한 앱에서 검증을 켠다. 그 앱들은 Alloy 가 `/metrics` 를 긁지 않으므로
 * (`dlq.metrics.ts:10`) 증명이 틀렸을 때 알아차릴 수단이 **로그뿐**이다. 그런데 이 라이브러리의
 * 진단 로그는 오랫동안 `logger.error('메시지', { topic, messageId, errors })` 모양이었고,
 * **그 두 번째 인자는 통째로 버려지고 있었다.**
 *
 * 이유는 nestjs-pino `Logger.call` 이다 — Nest 의 `Logger` 는 자기 context 를 마지막 인자로
 * 덧붙이므로 optionalParams 는 `[{객체}, 'ClassName']` 이 되고, nestjs-pino 는 **마지막**을
 * context 로 쓰고 나머지를 pino 의 보간 인자로 넘긴다. 메시지에 `%s` 가 없으면 pino 는 그것을
 * 출력하지 않는다. 결과: stdout 에도 Loki 에도 topic·messageId·errors 가 없다.
 *
 * 아래 첫 describe 가 그 사실의 **대조군**이다 — 옛 모양과 새 모양을 나란히 실행해 무엇이
 * 사라지고 무엇이 남는지 보인다. 두 번째 describe 는 옛 모양이 라이브러리에 다시 자라지 않게
 * AST 로 막는다. 대조군 없이 AST 단언만 두면 "왜 이 모양이어야 하는가"가 사라진다.
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { Logger as NestLogger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { LoggerModule, Logger as PinoNestLogger } from 'nestjs-pino';
import { Writable } from 'stream';

describe('진단 로그 모양 — nestjs-pino 를 지나며 무엇이 남는가', () => {
  /**
   * 앱들의 실제 배선을 그대로 세운다: `LoggerModule.forRoot` + `app.useLogger(app.get(Logger))`.
   * 목적지만 파일 대신 메모리 스트림으로 돌려 출력 줄을 읽는다.
   *
   * 두 모양을 **한 번의 부팅에서** 찍는다 — nestjs-pino 의 루트 pino 인스턴스는 모듈 스코프
   * 싱글턴이라 `forRoot` 를 두 번 부르면 두 번째 목적지가 무시되고 첫 번째 sink 로 흘러간다
   * (실제로 그렇게 한 판본이 조용히 빈 배열을 받았다).
   */
  let records: Array<Record<string, unknown>>;

  beforeAll(async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer | string, _enc, cb) {
        lines.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
        cb();
      },
    });

    @Module({
      imports: [LoggerModule.forRoot({ pinoHttp: [{ level: 'debug' }, sink] })],
    })
    class ProbeModule {}

    const app = await NestFactory.createApplicationContext(ProbeModule, { logger: false });
    app.useLogger(app.get(PinoNestLogger));
    const log = new NestLogger('SchemaValidationInterceptor');

    log.error('OLD_SHAPE OrderCreated', {
      topic: 'orders.events.v1',
      messageId: 'mid-1',
      errors: '  - payload.sku: Required',
    });
    log.error({
      msg: 'NEW_SHAPE OrderCreated',
      topic: 'orders.events.v1',
      messageId: 'mid-1',
      errors: '  - payload.sku: Required',
    });

    await app.close();

    records = lines
      .join('')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  });

  const find = (marker: string) => records.find((r) => String(r.msg).includes(marker));

  it('옛 모양 `error(문자열, {객체})` 는 객체를 통째로 잃는다 (대조군)', () => {
    const record = find('OLD_SHAPE');
    expect(record).toBeDefined();
    // 메시지와 context 는 남는다 — 그래서 "로그가 아예 안 나온다"로 오해하기 쉽다.
    expect(record!.context).toBe('SchemaValidationInterceptor');
    // 그러나 진단에 필요한 것은 전부 사라진다.
    expect(record).not.toHaveProperty('topic');
    expect(record).not.toHaveProperty('messageId');
    expect(record).not.toHaveProperty('errors');
  });

  it('새 모양 `error({ msg, ...필드 })` 는 필드를 구조화해 남긴다', () => {
    const record = find('NEW_SHAPE');
    expect(record).toBeDefined();
    expect(record!.context).toBe('SchemaValidationInterceptor');
    expect(record!.topic).toBe('orders.events.v1');
    expect(record!.messageId).toBe('mid-1');
    expect(record!.errors).toBe('  - payload.sku: Required');
  });
});

describe('옛 모양이 libs/events 에 다시 자라지 않는다', () => {
  const SRC = path.resolve(__dirname, '..');
  const LEVELS = new Set(['log', 'warn', 'error', 'debug', 'verbose', 'fatal']);

  function collectTsFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collectTsFiles(full, acc);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) acc.push(full);
    }
    return acc;
  }

  /** `<무엇이든>logger.<level>(<문자열>, {객체})` 호출 지점을 전부 찾는다. */
  function findDroppedFieldCalls(file: string): string[] {
    const text = fs.readFileSync(file, 'utf8');
    const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const hits: string[] = [];

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const receiver = node.expression.expression.getText(src);
        if (LEVELS.has(method) && /logger$/i.test(receiver) && node.arguments.length >= 2) {
          const [first, second] = node.arguments;
          const firstIsString =
            ts.isStringLiteral(first) || ts.isTemplateExpression(first) || ts.isNoSubstitutionTemplateLiteral(first);
          if (firstIsString && ts.isObjectLiteralExpression(second)) {
            const line = src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1;
            hits.push(`${path.relative(SRC, file)}:${line}  ${receiver}.${method}(…, { … })`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
    return hits;
  }

  it('`logger.<level>(문자열, {객체})` 호출이 0곳이다', () => {
    const files = collectTsFiles(SRC);
    // 판정기 자신이 죽어 있으면 0곳도 초록이다. 파일을 실제로 훑었는지 먼저 고정한다.
    expect(files.length).toBeGreaterThan(20);

    const hits = files.flatMap(findDroppedFieldCalls);
    expect(hits).toEqual([]);
  });

  it('판정기는 그 모양을 실제로 잡는다 (대조군 — 위 0곳이 무엇을 뜻하는지 고정)', () => {
    const fixture = path.join(__dirname, '__log-shape-fixture__.ts');
    fs.writeFileSync(
      fixture,
      [
        'declare const logger: { error: (...a: unknown[]) => void };',
        'export function f(topic: string) {',
        '  logger.error(`boom: ${topic}`, { topic });',
        '}',
        '',
      ].join('\n'),
    );
    try {
      expect(findDroppedFieldCalls(fixture)).toHaveLength(1);
    } finally {
      fs.unlinkSync(fixture);
    }
  });
});
