#!/usr/bin/env tsx
/**
 * 소비 측 스키마 검증(`validateOnConsume`)을 앱별로 켜도 되는지 판정한다 (ADR-0029 §8, 플랜 Task 5-C).
 *
 * ## 왜 이 스크립트인가 — 샘플링을 정적 증명으로 대체한다
 *
 * 플랜 Task 5-C 는 "인바운드 payload 가 실제로 zod 스키마를 만족하는지 **먼저** 확인"하라고 하고
 * 그 방법으로 "스테이징 샘플링 또는 5-B 상태에서 로그 관찰"을 제시한다. **둘 다 지금 불가능하다** —
 * AWS `dev` stage 는 폐기됐고, 5-B(배선 이주)는 커밋됐을 뿐 배포되지 않아 라이브는 여전히 옛 배선이라
 * 검증 인터셉터가 붙지 않는다(§8). 관찰할 로그 자체가 생기지 않는다.
 *
 * 대신 **발행 경로를 전수로 닫아** 같은 결론에 도달한다. 논증은 세 걸음이다:
 *
 * 1. Kafka 로 나가는 모든 경로는 `StreamPublisher` 를 지난다 (ADR-0029 §7, Task 2 에서 확립).
 * 2. `StreamPublisher` 의 발행 진입점은 **둘뿐**이다:
 *    - `publishEvent`  → `validateOnPublish` 로 zod 검증. 게다가 envelope 에 싣는 것은 원본이 아니라
 *      **zod 가 파싱한 결과**(`payload: validatedPayload`, `stream-publisher.service.ts:123`)다.
 *      즉 나가는 payload 는 스키마의 출력 그 자체라, 같은 스키마로 다시 검증하면 반드시 통과한다.
 *    - `publishRawEnvelope` → zod 우회.
 * 3. 따라서 **`publishRawEnvelope` 가 실어 나를 수 있는 (토픽, 이벤트) 만이 위험하다.**
 *    그 호출자는 레포 전체에 **2곳**뿐이다 (아래 BYPASS_PATHS).
 *
 * `validateOnPublish` 를 `false` 로 끄는 곳은 레포에 하나도 없다(실측). 발행·소비가 같은
 * `StreamConfig` 객체를 공유하는 것도 확인했다 — 모든 `forRoot({streams})` 가 계약 패키지의
 * 정규 export 를 그대로 넘긴다. 그래서 스키마가 양쪽에서 갈라질 수 없다.
 *
 * ## 판정
 *
 *   SAFE       스키마 없음, 또는 빈 객체까지 통과하는 관대한 스키마 → 켜도 동작이 안 바뀐다
 *   PROVEN     필수 필드가 있으나 우회 경로가 이 (토픽,이벤트) 에 닿지 않는다 → 발행 시 이미 검증됨
 *   UNVERIFIED 필수 필드 + 우회 경로가 닿는다 → 사람이 payload 를 봐야 한다
 *
 * `UNVERIFIED` 가 0인 앱은 검증을 켜도 안전하다는 정적 증명을 가진 것이다.
 *
 * ## 한계 (일부러 검사하지 않는 것)
 *
 * - **토픽에 남아 있는 옛 메시지.** 발행 코드가 지금 옳아도 계약 이전에 쌓인 메시지는 모양이 다를 수
 *   있다. 이 논증은 "앞으로 발행될 것"만 덮는다. retention 을 넘긴 뒤에야 완결된다.
 * - **레포 밖 발행자.** Medusa 등 다른 프로세스가 같은 토픽에 쓰면 이 논증 밖이다. 현재 확인된
 *   외부 발행자는 없다.
 * - `BYPASS_PATHS` 는 **손으로 유지하는 목록이다.** 그래서 `--gate` 가 `publishRawEnvelope` 호출
 *   지점을 실제로 세어 이 목록과 어긋나면 실패한다 — 목록이 조용히 낡는 것을 막는다.
 *
 * ## `--gate` 가 막는 것
 *
 * 1. **검증을 켜 둔 앱에 UNVERIFIED 이벤트가 생기는 것.** 5-C 로 켠 앱에 나중에 누가 outbox 발행
 *    이벤트의 핸들러를 추가하면, 이 판정이 조용히 뒤집히는 대신 CI 가 막는다. 5-C 의 분석을
 *    일회성 결론이 아니라 **상시 불변식**으로 바꾸는 것이 이 게이트의 목적이다.
 * 2. 위의 `BYPASS_PATHS` 낡음.
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
 * zod 를 우회해 Kafka 에 도달할 수 있는 경로. `publishRawEnvelope` 의 호출자와 1:1 대응한다.
 *
 * 각 항목은 "이 dispatcher 가 어느 토픽에 무엇을 실을 수 있는가" 를 적는다. 그 답은 dispatcher 가
 * 어떤 publisher 를 들고 있고 어떤 행을 읽는가로 정해진다.
 */
const BYPASS_PATHS = [
  {
    dispatcher: 'libs/events/src/outbox/outbox-dispatcher.service.ts:121',
    /** publisherMap 이 행의 `topic` 컬럼으로 조회되므로, 실릴 수 있는 것은 `saveEvent` 가 쓴 (topic,eventType) 뿐이다. */
    writers: 'OutboxPublisher.saveEvent',
    resolve: 'saveEvent-call-sites' as const,
  },
  {
    dispatcher: 'apps/wallet/src/messaging/outbox-dispatcher.service.ts:171',
    /**
     * publisher 가 `PAYMENT_EVENTS_TOPIC` 하나로 고정 주입된다(:45) — 즉 실리는 토픽은
     * `payments.events.v1` 하나다. 실릴 수 있는 **이벤트명**은 wallet 이 자기 `outbox_events` 에
     * 넣는 것뿐이고, 그 이름은 전부 `*EventType` const 맵에서 온다 (`GatewayEventType` ·
     * `InvoiceEventType`). 그 맵들의 값 전체를 우회 집합으로 잡는다 — 실제 insert 지점을 일일이
     * 따라가면 헬퍼 함수를 거치는 갈래에서 놓칠 수 있고, 놓치면 위험한 쪽(PROVEN 오판)으로 틀린다.
     * 과대추정은 안전한 방향이다.
     */
    writers: 'wallet outbox_events 직접 insert',
    resolve: 'wallet-event-consts' as const,
    topic: 'payments.events.v1',
  },
];

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

interface SaveEventSite {
  where: string;
  topic?: string;
  event?: string;
}

function scanFile(rel: string): { consumers: Consumer[]; saveEvents: SaveEventSite[] } {
  const abs = path.join(REPO, rel);
  const source = ts.createSourceFile(abs, fs.readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true);
  const consts = collectStringConsts(source);
  const app = rel.split('/')[1];
  const consumers: Consumer[] = [];
  const saveEvents: SaveEventSite[] = [];
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

    // 우회 경로 1의 writer: `outboxPublisher.saveEvent({ topic, eventType, … }, tx)`
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const arg0 = node.arguments[0];
      if (node.expression.name.getText() === 'saveEvent' && arg0 && ts.isObjectLiteralExpression(arg0)) {
        saveEvents.push({
          where: `${rel}:${lineOf(node)}`,
          topic: resolveTopicExpression(propOf(arg0, 'topic'), consts),
          event: resolveString(propOf(arg0, 'eventType'), consts),
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
  return { consumers, saveEvents };
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

/**
 * wallet 이 자기 outbox 에 실을 수 있는 이벤트명 전부.
 *
 * `apps/wallet/src` 안의 `const *EventType = { … } as const` 값들과, `eventType:` 자리에 직접 쓰인
 * 문자열 리터럴을 모은다. 과대추정 방향으로만 틀리게 설계했다 — 빠뜨리면 PROVEN 오판이 되고,
 * 더 넣으면 UNVERIFIED 가 늘 뿐이다.
 */
function walletOutboxEventTypes(): Set<string> {
  const found = new Set<string>();
  for (const rel of grepFiles('EventType|eventType:', 'apps/wallet/src')) {
    const abs = path.join(REPO, rel);
    const source = ts.createSourceFile(abs, fs.readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true);
    const consts = collectStringConsts(source);

    const visit = (node: ts.Node) => {
      // const XxxEventType = { KEY: 'value' } as const
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /EventType$/.test(node.name.text)) {
        let init = node.initializer;
        while (init && ts.isAsExpression(init)) init = init.expression;
        if (init && ts.isObjectLiteralExpression(init)) {
          for (const p of init.properties) {
            if (ts.isPropertyAssignment(p) && ts.isStringLiteral(p.initializer)) found.add(p.initializer.text);
          }
        }
      }
      // eventType: 'literal'
      if (ts.isPropertyAssignment(node) && node.name.getText() === 'eventType') {
        const v = resolveString(node.initializer, consts);
        if (v) found.add(v);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

/**
 * `publishRawEnvelope` **호출** 지점 — BYPASS_PATHS 가 낡았는지 확인하는 근거.
 *
 * grep 이 아니라 AST 로 센다. 이 이름은 설명 주석에도 자주 등장하고(이 스크립트를 설명하는
 * 주석까지 포함해서), 실제로 grep 판본이 `sales-order.module.ts` 의 근거 주석을 세 번째
 * "호출자"로 집계해 거짓 경보를 냈다. 세는 대상이 호출이면 호출만 세야 한다.
 */
function findRawEnvelopeCallers(): string[] {
  const hits: string[] = [];
  for (const rel of grepFiles('publishRawEnvelope', 'apps libs')) {
    const abs = path.join(REPO, rel);
    const source = ts.createSourceFile(abs, fs.readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.getText() === 'publishRawEnvelope'
      ) {
        hits.push(`${rel}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return hits.sort();
}

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const gate = argv.includes('--gate');
  const only = argv.filter((a) => !a.startsWith('--'));

  const files = [...new Set([...grepFiles('@On\\(', 'apps'), ...grepFiles('saveEvent\\(', 'apps')])];
  const consumers: Consumer[] = [];
  const saveEvents: SaveEventSite[] = [];
  for (const rel of files) {
    const r = scanFile(rel);
    consumers.push(...r.consumers);
    saveEvents.push(...r.saveEvents);
  }

  // 우회 가능한 (토픽, 이벤트) 집합을 만든다.
  const bypassPairs = new Map<string, string[]>(); // "topic|event" → 근거
  for (const p of BYPASS_PATHS) {
    const add = (topic: string, event: string, why: string) => {
      const key = `${topic}|${event}`;
      bypassPairs.set(key, [...(bypassPairs.get(key) ?? []), why]);
    };
    if (p.resolve === 'wallet-event-consts') {
      for (const event of walletOutboxEventTypes()) add(p.topic, event, `${p.writers} → ${p.dispatcher}`);
    } else {
      for (const s of saveEvents) {
        if (s.topic && s.event) add(s.topic, s.event, `${p.writers} ${s.where}`);
      }
    }
  }

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
      reason = `필수 필드 + zod 우회 발행 경로 ${bypass.length}건이 이 이벤트에 닿는다`;
    } else {
      verdict = 'PROVEN';
      reason = '필수 필드가 있으나 우회 경로가 닿지 않는다 → publishEvent 가 zod 파싱 결과를 실어 보낸다';
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

  // BYPASS_PATHS 가 실제 호출자와 어긋났는지 — 손으로 유지하는 목록이 조용히 낡는 것을 막는다.
  const callers = findRawEnvelopeCallers();
  const staleBypassList = callers.length !== BYPASS_PATHS.length;

  if (asJson) {
    console.log(JSON.stringify({ summary, rows, bypassPaths: BYPASS_PATHS, rawEnvelopeCallers: callers }, null, 2));
  } else {
    console.log('소비 검증 준비도 (validateOnConsume 를 켜도 되는가) — ADR-0029 §8 / 플랜 Task 5-C\n');
    console.log(`zod 우회 경로: publishRawEnvelope 호출자 ${callers.length}곳`);
    for (const c of callers) console.log(`  ${c}`);
    if (staleBypassList) {
      console.log(
        `\n⚠️  BYPASS_PATHS 는 ${BYPASS_PATHS.length}곳을 가정하는데 실제는 ${callers.length}곳이다 — 목록이 낡았다.`,
      );
    }

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
      for (const b of r.bypass) console.log(`  우회: ${b}`);
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
    if (violations.length === 0 && !staleBypassList) console.log('위반 없음.');
    for (const v of violations) {
      console.log(`🔴 ${v.app}: validateOnConsume=true (${v.policyAt}) 인데 UNVERIFIED ${v.UNVERIFIED}건`);
    }
  }

  process.exit(gate && (staleBypassList || violations.length > 0) ? 1 : 0);
}

main();
