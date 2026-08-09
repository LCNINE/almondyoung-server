#!/usr/bin/env tsx
/**
 * 소비 측 스키마 검증(`validateOnConsume`)을 앱별로 켜도 되는지 판정한다 (ADR-0029 §8, 플랜 Task 5-C).
 *
 * ## 왜 이 스크립트인가 — 샘플링을 정적 증명으로 대체한다
 *
 * 플랜 Task 5-C 는 "인바운드 payload 가 실제로 zod 스키마를 만족하는지 **먼저** 확인"하라고 하고
 * 그 방법으로 "스테이징 샘플링 또는 5-B 상태에서 로그 관찰"을 제시한다. **둘 다 지금 불가능하다** —
 * AWS `dev` stage 는 폐기됐고, 배선 이주가 배포되기 전에는 검증 인터셉터가 붙지 않아 관찰할 로그
 * 자체가 생기지 않는다. 대신 **발행 경로를 전수로 닫아** 같은 결론에 도달한다.
 *
 * ## 불변식 (Task 6-A 이후)
 *
 * **Kafka 로 나가는 모든 payload 는 zod 파싱을 통과한 값이다.** 근거는 세 걸음이고 전부 AST 로 센다:
 *
 * 1. 프로덕션 코드에서 `kafkajs` 를 직접 잡는 곳은 없다 → 모든 전송은 `EventTransport.send` 를 지난다.
 * 2. `transport.send` 호출 지점은 아래 `SEND_PATHS` 가 전부다.
 * 3. 그중 `StreamPublisher.sendMessage` 를 지나는 것은 검증된 진입점 셋뿐이다
 *    (`publishEvent` · `publishCommand` · `publishStoredEnvelope`). 셋 다 envelope 에 싣는 것이
 *    원본이 아니라 **zod 가 파싱한 결과**다. 파싱은 멱등이므로 같은 스키마의 소비 검증을 반드시
 *    통과한다.
 *
 * Task 6-A 이전에는 `publishRawEnvelope` 가 3번의 예외였다 — 아웃박스가 zod 를 우회하는 유일한
 * 경로였고, 그래서 아웃박스로 나가는 4개 이벤트가 UNVERIFIED 로 남아 세 앱을 막고 있었다.
 * 이제 적재(`enqueue`)와 발행(`publishStoredEnvelope`) 양쪽에 문이 있고 우회는 없다.
 *
 * ## 판정
 *
 *   SAFE       스키마 없음, 또는 빈 객체까지 통과하는 관대한 스키마 → 켜도 동작이 안 바뀐다
 *   PROVEN     필수 필드가 있고, 우회 경로가 이 (토픽,이벤트) 에 닿지 않는다 → 발행 시 이미 검증됨
 *   UNVERIFIED 필수 필드 + 검증되지 않는 발행 경로가 닿는다 → 사람이 payload 를 봐야 한다
 *
 * `UNVERIFIED` 가 0인 앱은 검증을 켜도 안전하다는 정적 증명을 가진 것이다.
 *
 * ## 한계 (일부러 검사하지 않는 것)
 *
 * - **토픽에 남아 있는 옛 메시지.** 발행 코드가 지금 옳아도 계약 이전에 쌓인 메시지는 모양이 다를 수
 *   있다. 이 논증은 "앞으로 발행될 것"만 덮는다. retention 을 넘긴 뒤에야 완결된다.
 *   `DLQHandler.reprocessDLQ`(관리자 수동 재처리)가 이 한계와 같은 성질이라 아래에서 면제된다 —
 *   그 토픽에 이미 있던 메시지를 되돌려 보낼 뿐 새 모양을 만들지 않는다.
 * - **레포 밖 발행자.** Medusa 등 다른 프로세스가 같은 토픽에 쓰면 이 논증 밖이다. 현재 확인된
 *   외부 발행자는 없다.
 * - `SEND_PATHS` 는 **손으로 유지하는 목록이다.** 그래서 `--gate` 가 실제 호출 지점을 세어 이
 *   목록과 어긋나면 실패한다 — 목록이 조용히 낡는 것을 막는다.
 *
 * ## `--gate` 가 막는 것
 *
 * 1. **검증을 켜 둔 앱에 UNVERIFIED 이벤트가 생기는 것.** 5-C 의 분석을 일회성 결론이 아니라
 *    **상시 불변식**으로 바꾸는 것이 이 게이트의 목적이다.
 * 2. **발행 경로가 늘어나는 것.** `transport.send` 호출 지점이 `SEND_PATHS` 와 다르거나,
 *    `StreamPublisher.sendMessage` 를 부르는 메서드가 검증된 셋 밖으로 늘어나면 실패한다.
 *    새 발행 경로는 반드시 사람이 검증 여부를 판단하고 이 목록에 적어야 한다.
 * 3. **`validateOnPublish: false`.** 위 불변식은 이 스위치가 켜져 있다는 데 전적으로 기댄다.
 *    끄는 순간 증명 전체가 무너지므로 레포 어디에도 있어선 안 된다.
 * 4. **`publishRawEnvelope` 부활.** 6-A 가 지운 이름이다. 되살아나면 우회도 되살아난다.
 *
 * 사용법:
 *   npm run audit:consume-validation
 *   npm run audit:consume-validation -- --json
 *   npm run audit:consume-validation -- --gate          # 위 두 가지 중 하나라도 걸리면 exit 1
 *   npm run audit:consume-validation -- core analytics
 */
import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { STREAM_REGISTRY } from '../../packages/event-contracts/streams/registry';
import * as streamExports from '../../packages/event-contracts/streams';
import type { StreamConfig } from '../../packages/event-contracts/types/stream-config.types';

const REPO = path.resolve(__dirname, '..', '..');

/**
 * `EventTransport.send` 호출 지점 전부. 손으로 유지하고 `--gate` 가 AST 로 대조한다.
 *
 * `validated: true` 인 항목은 그 경로로 나가는 payload 가 zod 파싱을 통과한 값임을 뜻한다.
 * `validated: false` 인 항목이 하나라도 생기면 그 경로가 실어 나를 수 있는 (토픽, 이벤트) 가
 * UNVERIFIED 가 되고, `resolve` 로 그 집합을 계산하는 코드를 여기에 붙여야 한다.
 */
const SEND_PATHS: Array<{ site: string; what: string; validated: boolean }> = [
  {
    site: 'libs/events/src/publishers/stream-publisher.service.ts',
    what: 'StreamPublisher.sendMessage — 검증된 진입점 셋만 부른다 (아래 VALIDATED_SEND_ENTRYPOINTS)',
    validated: true,
  },
  {
    site: 'libs/events/src/dlq/dlq-handler.service.ts',
    what: 'DLQHandler.sendToDLQ — DLQ 토픽으로만 나간다. 계약 토픽이 아니므로 소비 검증 대상이 아니다',
    validated: true,
  },
  {
    site: 'libs/events/src/dlq/dlq-handler.service.ts',
    what:
      'DLQHandler.reprocessDLQ — 관리자 수동 재처리. 원본 토픽으로 되돌려 보내지만 ' +
      '**그 토픽에 이미 있던 메시지**뿐이라 새 모양을 만들지 않는다 (위 "한계" 의 옛 메시지와 같은 성질)',
    validated: true,
  },
];

/**
 * `StreamPublisher.sendMessage` 를 부르는 메서드 — 전부 zod 파싱 결과를 싣는다.
 * 여기 없는 메서드가 `sendMessage` 를 부르면 게이트가 실패한다. 그것이 새 우회의 모양이다.
 */
const VALIDATED_SEND_ENTRYPOINTS = ['publishEvent', 'publishCommand', 'publishStoredEnvelope'].sort();

/**
 * 앱의 `validateOnConsume` 선언을 **소스에서 도출한다.** 목록으로 들고 있지 않는 이유는
 * ADR-0029 §1 과 같다 — 도출 가능한 사실을 선언으로 받으면 두 벌이 생기고, 두 벌은 어긋난다.
 * 선언이 없으면 `DEFAULT_SCHEMA_VALIDATION_OPTIONS` 의 `true` 로 떨어진다(그것이 이 워크스트림
 * 내내 "누락으로 켜진다"고 경고해 온 바로 그 기본값이다).
 *
 * 주석 안의 `validateOnConsume: true` 같은 산문에 걸리지 않도록 정규식이 아니라 AST 로 읽는다 —
 * channel-adapter 의 설명 주석이 실제로 그 문자열을 담고 있다.
 */
function declaredPolicy(app: string): { validateOnConsume: boolean; where: string } {
  for (const rel of grepFiles('validateOnConsume', `apps/${app}/src`)) {
    const abs = path.join(REPO, rel);
    const source = ts.createSourceFile(abs, fs.readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true);
    let found: { validateOnConsume: boolean; where: string } | undefined;
    const visit = (node: ts.Node) => {
      if (found) return;
      if (ts.isPropertyAssignment(node) && node.name.getText() === 'validateOnConsume') {
        const kind = node.initializer.kind;
        if (kind === ts.SyntaxKind.TrueKeyword || kind === ts.SyntaxKind.FalseKeyword) {
          found = {
            validateOnConsume: kind === ts.SyntaxKind.TrueKeyword,
            where: `${rel}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`,
          };
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (found) return found;
  }
  return { validateOnConsume: true, where: '<선언 없음 → 기본값 true>' };
}

type Verdict = 'SAFE' | 'PROVEN' | 'UNVERIFIED';

interface Consumer {
  app: string;
  where: string;
  method: string;
  streamIdent: string;
  event: string;
}

// ─── 스트림 식별자 → 토픽 ───────────────────────────────────────────────────
// 앱 코드의 `@On(PAYMENT_STREAM, …)` 식별자는 계약 패키지의 export 이름 그대로다.
// 별칭 import(`as X`)는 현재 없고, 생기면 아래에서 미해결로 드러난다.
const topicByIdent = new Map<string, string>();
for (const [name, value] of Object.entries(streamExports as Record<string, unknown>)) {
  const c = value as Partial<StreamConfig>;
  if (c && typeof c === 'object' && c.topic && typeof c.topic.topic === 'string') {
    topicByIdent.set(name, c.topic.topic);
  }
}

// ─── AST 스캔 ───────────────────────────────────────────────────────────────

const decoratorsOf = (node: ts.Node) =>
  (ts.getDecorators(node as ts.HasDecorators) ?? []).map((d) => {
    const e = d.expression;
    return ts.isCallExpression(e)
      ? { name: e.expression.getText(), args: [...e.arguments] }
      : { name: e.getText(), args: [] as ts.Expression[] };
  });

/** 같은 파일의 `const NAME = 'literal'` 를 푼다 (audit 게이트와 같은 이유 — 상수로 뽑아 쓰는 곳이 있다). */
function collectStringConsts(source: ts.SourceFile): Map<string, string> {
  const consts = new Map<string, string>();
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      let init: ts.Expression = node.initializer;
      while (ts.isAsExpression(init)) init = init.expression;
      if (ts.isStringLiteral(init)) consts.set(node.name.text, init.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return consts;
}

function resolveString(node: ts.Expression | undefined, consts: Map<string, string>): string | undefined {
  if (!node) return undefined;
  let n: ts.Expression = node;
  while (ts.isAsExpression(n)) n = n.expression;
  if (ts.isStringLiteral(n)) return n.text;
  if (ts.isIdentifier(n)) return consts.get(n.text);
  return undefined;
}

/** `X.topic.topic` / `X.topic` / 문자열 리터럴에서 토픽을 얻는다. */
function resolveTopicExpression(node: ts.Expression | undefined, consts: Map<string, string>): string | undefined {
  if (!node) return undefined;
  const literal = resolveString(node, consts);
  if (literal) return literal;
  const m = /^([A-Z][A-Z0-9_]*)\.topic(\.topic)?$/.exec(node.getText());
  return m ? topicByIdent.get(m[1]) : undefined;
}

function propOf(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && p.name.getText() === name) return p.initializer;
  }
  return undefined;
}

function scanFile(rel: string): { consumers: Consumer[] } {
  const abs = path.join(REPO, rel);
  const source = ts.createSourceFile(abs, fs.readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true);
  const consts = collectStringConsts(source);
  const app = rel.split('/')[1];
  const consumers: Consumer[] = [];
  const lineOf = (n: ts.Node) => source.getLineAndCharacterOfPosition(n.getStart()).line + 1;

  const visit = (node: ts.Node) => {
    if (ts.isMethodDeclaration(node)) {
      const on = decoratorsOf(node).find((d) => d.name === 'On');
      if (on) {
        const streamArg = on.args[0];
        const streamIdent = streamArg && ts.isIdentifier(streamArg) ? streamArg.text : streamArg?.getText();
        const event = resolveString(on.args[1], consts);
        const cls = ts.isClassDeclaration(node.parent) ? node.parent.name?.getText() : undefined;
        if (streamIdent && event) {
          consumers.push({
            app,
            where: `${rel}:${lineOf(node)}`,
            method: `${cls ?? '?'}.${node.name.getText()}`,
            streamIdent,
            event,
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
  return { consumers };
}

// ─── 스키마 분류 ────────────────────────────────────────────────────────────

/**
 * 스키마를 **실행해서** 분류한다 — zod 내부 구조(`_def`)를 들여다보지 않는다.
 * zod 판올림에 내부 모양이 바뀌어도 이 판정은 따라 깨지지 않는다.
 */
function classifySchema(schema: unknown): { permissive: boolean; required: string[] } | null {
  const s = schema as {
    safeParse?: (v: unknown) => { success: boolean; error?: { issues: Array<{ path: PropertyKey[] }> } };
  };
  if (!s || typeof s.safeParse !== 'function') return null;

  const empty = s.safeParse({});
  // 빈 객체를 통과시키면 필수 필드가 없다는 뜻 — 어떤 라이브 payload 도 이걸 못 넘길 수 없다.
  if (empty.success) return { permissive: true, required: [] };

  const required = (empty.error?.issues ?? []).map((i) => i.path.map(String).join('.')).filter((p) => p.length > 0);
  return { permissive: false, required: [...new Set(required)].sort() };
}

// ─── 실행 ───────────────────────────────────────────────────────────────────

function grepFiles(pattern: string, scope: string): string[] {
  try {
    return execSync(`grep -rlE ${JSON.stringify(pattern)} ${scope} --include=*.ts | grep -v '\\.spec\\.' | sort`, {
      cwd: REPO,
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** AST 로 파일을 훑는 공통 헬퍼. */
function eachNode(rel: string, fn: (node: ts.Node, line: () => number) => void): void {
  const abs = path.join(REPO, rel);
  const source = ts.createSourceFile(abs, fs.readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node) => {
    fn(node, () => source.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    ts.forEachChild(node, visit);
  };
  visit(source);
}

/** 이름으로 메서드 호출 지점을 센다. grep 이 아니라 AST — 이름은 주석에도 자주 등장한다. */
function findMethodCalls(name: string, scope: string): string[] {
  const hits: string[] = [];
  for (const rel of grepFiles(name, scope)) {
    eachNode(rel, (node, line) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.getText() === name
      ) {
        hits.push(`${rel}:${line()}`);
      }
    });
  }
  return hits.sort();
}

/**
 * `StreamPublisher.sendMessage` 를 부르는 **메서드 이름** 집합.
 *
 * 새 발행 진입점이 생기면 여기 나타난다. 그 메서드가 검증을 하는지는 사람만 판단할 수 있으므로,
 * 게이트는 판단을 요구할 뿐 대신 내리지 않는다.
 */
function findSendMessageCallers(): string[] {
  const rel = 'libs/events/src/publishers/stream-publisher.service.ts';
  const names = new Set<string>();
  eachNode(rel, (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.getText() === 'sendMessage'
    ) {
      let cur: ts.Node | undefined = node;
      while (cur && !ts.isMethodDeclaration(cur)) cur = cur.parent;
      if (cur && ts.isMethodDeclaration(cur)) names.add(cur.name.getText());
    }
  });
  return [...names].sort();
}

/** `validateOnPublish: false` — 위 불변식 전체가 이 스위치에 기댄다. */
function findValidateOnPublishOff(): string[] {
  const hits: string[] = [];
  for (const rel of grepFiles('validateOnPublish', 'apps libs packages')) {
    eachNode(rel, (node, line) => {
      if (
        ts.isPropertyAssignment(node) &&
        node.name.getText() === 'validateOnPublish' &&
        node.initializer.kind === ts.SyntaxKind.FalseKeyword
      ) {
        hits.push(`${rel}:${line()}`);
      }
    });
  }
  return hits.sort();
}

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const gate = argv.includes('--gate');
  const only = argv.filter((a) => !a.startsWith('--'));

  const files = grepFiles('@On\\(', 'apps');
  const consumers: Consumer[] = [];
  for (const rel of files) {
    consumers.push(...scanFile(rel).consumers);
  }

  // 검증되지 않는 발행 경로가 실어 나를 수 있는 (토픽, 이벤트). Task 6-A 이후 그런 경로는 없다 —
  // `SEND_PATHS` 에 `validated: false` 항목이 다시 생기면 여기에 그 집합을 계산하는 코드를 붙인다.
  const bypassPairs = new Map<string, string[]>(); // "topic|event" → 근거
  const unvalidatedSendPaths = SEND_PATHS.filter((p) => !p.validated);

  interface Row {
    app: string;
    topic: string;
    event: string;
    handlers: number;
    verdict: Verdict;
    reason: string;
    required: string[];
    bypass: string[];
  }

  const rows: Row[] = [];

  for (const c of consumers) {
    if (only.length && !only.includes(c.app)) continue;
    const topic = topicByIdent.get(c.streamIdent);

    const existing = rows.find((r) => r.app === c.app && r.event === c.event && r.topic === topic);
    if (existing) {
      existing.handlers += 1;
      continue;
    }

    if (!topic) {
      rows.push({
        app: c.app,
        topic: `<미해결: ${c.streamIdent}>`,
        event: c.event,
        handlers: 1,
        verdict: 'UNVERIFIED',
        reason: '스트림 식별자를 토픽으로 풀 수 없다 (별칭 import?)',
        required: [],
        bypass: [],
      });
      continue;
    }

    const eventConfig = STREAM_REGISTRY[topic]?.events?.[c.event] as { schema?: unknown } | undefined;
    const cls = eventConfig ? classifySchema(eventConfig.schema) : null;
    const bypass = bypassPairs.get(`${topic}|${c.event}`) ?? [];

    let verdict: Verdict;
    let reason: string;
    if (!eventConfig) {
      verdict = 'SAFE';
      reason = '계약에 이 이벤트가 없다 → 인터셉터가 warn 후 통과 (검증 안 함)';
    } else if (!cls) {
      verdict = 'SAFE';
      reason = 'zod 스키마 없음 → 인터셉터가 통과';
    } else if (cls.permissive) {
      verdict = 'SAFE';
      reason = '빈 객체까지 통과하는 관대한 스키마 → 켜도 동작 불변';
    } else if (bypass.length > 0) {
      verdict = 'UNVERIFIED';
      reason = `필수 필드 + 검증되지 않는 발행 경로 ${bypass.length}건이 이 이벤트에 닿는다`;
    } else {
      verdict = 'PROVEN';
      reason = '필수 필드가 있으나 검증되지 않는 발행 경로가 없다 → 나가는 payload 는 zod 파싱 결과다';
    }

    rows.push({
      app: c.app,
      topic,
      event: c.event,
      handlers: 1,
      verdict,
      reason,
      required: cls?.required ?? [],
      bypass,
    });
  }

  rows.sort((a, b) => a.app.localeCompare(b.app) || a.topic.localeCompare(b.topic) || a.event.localeCompare(b.event));

  const apps = [...new Set(rows.map((r) => r.app))].sort();
  const summary = apps.map((app) => {
    const own = rows.filter((r) => r.app === app);
    const count = (v: Verdict) => own.filter((r) => r.verdict === v).length;
    const policy = declaredPolicy(app);
    const ready = count('UNVERIFIED') === 0;
    return {
      app,
      validateOnConsume: policy.validateOnConsume,
      policyAt: policy.where,
      events: own.length,
      handlers: own.reduce((n, r) => n + r.handlers, 0),
      SAFE: count('SAFE'),
      PROVEN: count('PROVEN'),
      UNVERIFIED: count('UNVERIFIED'),
      ready,
      /** 검증을 켜 둔 앱에 미검증 이벤트가 있으면 위반 — 이것이 게이트가 막는 것이다. */
      violation: policy.validateOnConsume && !ready,
    };
  });

  // ── 발행 경로 무결성 ─────────────────────────────────────────────────────
  // 손으로 유지하는 SEND_PATHS 가 실제 코드와 어긋나면 위 불변식의 근거가 사라진다.
  const transportSends = findMethodCalls('send', 'libs/events/src').filter((h) => !h.includes('.spec.'));
  const sendMessageCallers = findSendMessageCallers();
  const validateOff = findValidateOnPublishOff();
  const rawEnvelopeCallers = findMethodCalls('publishRawEnvelope', 'apps libs');

  const integrity: string[] = [];
  if (transportSends.length !== SEND_PATHS.length) {
    integrity.push(
      `transport.send 호출이 ${transportSends.length}곳인데 SEND_PATHS 는 ${SEND_PATHS.length}곳을 가정한다 — ` +
        `목록이 낡았다: ${transportSends.join(', ')}`,
    );
  }
  if (sendMessageCallers.join('|') !== VALIDATED_SEND_ENTRYPOINTS.join('|')) {
    integrity.push(
      `StreamPublisher.sendMessage 를 부르는 메서드가 [${sendMessageCallers.join(', ')}] 인데 ` +
        `검증된 진입점은 [${VALIDATED_SEND_ENTRYPOINTS.join(', ')}] 이다 — 새 발행 경로의 검증 여부를 사람이 판단해야 한다`,
    );
  }
  if (validateOff.length > 0) {
    integrity.push(`validateOnPublish: false 가 있다 (${validateOff.join(', ')}) — 이 증명 전체가 무너진다`);
  }
  if (rawEnvelopeCallers.length > 0) {
    integrity.push(`publishRawEnvelope 가 되살아났다 (${rawEnvelopeCallers.join(', ')}) — zod 우회가 함께 돌아온다`);
  }
  if (unvalidatedSendPaths.length > 0) {
    integrity.push(
      `SEND_PATHS 에 검증되지 않는 경로가 있다 (${unvalidatedSendPaths.map((p) => p.what).join('; ')}) — ` +
        'bypassPairs 계산을 다시 붙여야 한다',
    );
  }

  if (asJson) {
    console.log(
      JSON.stringify({ summary, rows, sendPaths: SEND_PATHS, transportSends, sendMessageCallers, integrity }, null, 2),
    );
  } else {
    console.log('소비 검증 준비도 (validateOnConsume 를 켜도 되는가) — ADR-0029 §8 / 플랜 Task 5-C·6-A\n');
    console.log(`발행 경로 (transport.send 호출 ${transportSends.length}곳):`);
    for (const p of SEND_PATHS) console.log(`  ${p.validated ? '✅' : '⚠️ '} ${p.site} — ${p.what}`);
    console.log(`검증된 발행 진입점: ${sendMessageCallers.join(', ')}`);
    for (const problem of integrity) console.log(`\n⚠️  ${problem}`);

    console.log('\n앱                검증  이벤트  핸들러   SAFE  PROVEN  UNVERIFIED   판정');
    for (const s of summary) {
      const verdict = s.violation
        ? '🔴 위반 — 검증 ON 인데 미검증 이벤트가 있다'
        : s.validateOnConsume
          ? '✅ 켜짐 · 전부 검증됨'
          : s.ready
            ? '☑️  꺼짐 · 켜도 안전'
            : '⚠️  꺼짐 · 켜기 전 사람 확인 필요';
      console.log(
        `${s.app.padEnd(17)}${(s.validateOnConsume ? 'ON' : 'off').padEnd(6)}` +
          `${String(s.events).padStart(5)}${String(s.handlers).padStart(8)}` +
          `${String(s.SAFE).padStart(7)}${String(s.PROVEN).padStart(8)}${String(s.UNVERIFIED).padStart(12)}   ${verdict}`,
      );
    }

    const risky = rows.filter((r) => r.verdict === 'UNVERIFIED');
    console.log(`\n── UNVERIFIED ${risky.length}건 (사람이 payload 를 봐야 하는 것) ──────────────`);
    if (risky.length === 0) console.log('없음.');
    for (const r of risky) {
      console.log(`\n${r.app}  ${r.topic}  ${r.event}  (핸들러 ${r.handlers})`);
      console.log(`  ${r.reason}`);
      if (r.required.length) console.log(`  필수: ${r.required.join(', ')}`);
      for (const b of r.bypass) console.log(`  경로: ${b}`);
    }

    const proven = rows.filter((r) => r.verdict === 'PROVEN');
    console.log(`\n── PROVEN ${proven.length}건 (필수 필드가 있으나 발행 시 검증됨) ───────────────`);
    for (const r of proven) console.log(`  ${r.app.padEnd(16)} ${r.topic.padEnd(26)} ${r.event}`);
  }

  const violations = summary.filter((s) => s.violation);
  if (!asJson && gate) {
    console.log('\n── 게이트 ────────────────────────────────────────────────────');
    console.log(
      `검증 ON 인 앱: ${
        summary
          .filter((s) => s.validateOnConsume)
          .map((s) => s.app)
          .join(', ') || '없음'
      }`,
    );
    if (violations.length === 0 && integrity.length === 0) console.log('위반 없음.');
    for (const v of violations) {
      console.log(`🔴 ${v.app}: validateOnConsume=true (${v.policyAt}) 인데 UNVERIFIED ${v.UNVERIFIED}건`);
    }
    for (const problem of integrity) console.log(`🔴 ${problem}`);
  }

  process.exit(gate && (integrity.length > 0 || violations.length > 0) ? 1 : 0);
}

main();
