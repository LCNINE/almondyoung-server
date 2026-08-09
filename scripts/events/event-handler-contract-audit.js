#!/usr/bin/env node
/**
 * 이벤트 소비 핸들러의 **계약 도출 일관성** 전수 감사 (ADR-0029 §4, 플랜 Task 5-A).
 *
 * 무엇을 막는가 — `@On` 은 이벤트명 *오타*는 잡지만 *불일치*는 못 잡는다:
 *
 *   @On(PAYMENT_STREAM, 'PaymentCaptured')
 *   async h(@EventPayload() p: EventPayloadOf<typeof PAYMENT_STREAM, 'PaymentFailed'>) {}
 *   //                                                              ^^^^^^^^^^^^^^^ 컴파일된다
 *
 * 파라미터 데코레이터 순서가 앱마다 4가지이고(envelope-우선 45 · payload-우선 20 ·
 * payload-only 12 · envelope-only 10, 2026-08-09 실측) 이 레포는 `strictFunctionTypes` 가
 * 꺼져 있어 `TypedPropertyDescriptor` 제약이 반공변으로 걸리지 않는다. 즉 타입으로 막을
 * 방법이 없고, 핸들러 87개를 사람 눈으로 맞추면 반드시 샌다. 그 자리를 이 게이트가 막는다.
 *
 * 왜 AST 인가 — 여러 줄 데코레이터(`@On(\n  STREAM,\n  'Event',\n)`)와 여러 줄 파라미터
 * 주석이 흔해 정규식은 핸들러를 통째로 놓친다. 선례: `scripts/security/route-authz-audit.js`
 * (정규식 집계로 무방비 쓰기를 105건으로 과소집계했다가 실제 207건이었다).
 *
 * 이 게이트는 **순수 구문 검사**다. `@On` 의 스트림·이벤트가 실재하는지는 검사하지 않는다 —
 * 그건 `EventKeysOf` 가 컴파일 시점에, `@On` 의 런타임 가드가 부팅 시점에 이미 잡는다.
 * 여기서 또 검사하면 계약 로딩이라는 두 번째 진실이 생긴다.
 *
 * 사용법:
 *   node scripts/events/event-handler-contract-audit.js                  # 전체 앱
 *   node scripts/events/event-handler-contract-audit.js core membership  # 특정 앱
 *   node scripts/events/event-handler-contract-audit.js --json           # 기계 판독용
 *   node scripts/events/event-handler-contract-audit.js --allow-legacy   # 이주 중: @OnEvent 잔량 허용
 *
 * 종료 코드: 발견이 하나라도 있으면 1.
 */
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');

/** 계약에서 도출되는 파라미터 타입. 왼쪽 데코레이터에는 오른쪽 제네릭만 허용된다. */
const DERIVED_TYPE_FOR = {
  EventPayload: 'EventPayloadOf',
  EventEnvelope: 'EnvelopeOf',
};

const decoratorsOf = (node) =>
  (ts.getDecorators(node) ?? []).map((d) => {
    const e = d.expression;
    return ts.isCallExpression(e)
      ? { name: e.expression.getText(), args: [...e.arguments] }
      : { name: e.getText(), args: [] };
  });

/**
 * 파일 안의 `const NAME = 'literal'` 를 모은다.
 *
 * `@On(PRODUCT_STREAM, MASTER_DELETED)` 처럼 이벤트명을 파일 상수로 뽑아 쓰는 곳이 있다
 * (channel-adapter 의 pim-product-event.consumer.ts). 상수를 못 풀면 그 핸들러만 조용히
 * 감사 밖으로 빠지므로 — 이 게이트가 없애려는 실패 모드 그 자체다 — 같은 파일 상수는 푼다.
 */
function collectStringConsts(source) {
  const consts = new Map();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      let init = node.initializer;
      // `'x' as const` 를 벗긴다
      while (ts.isAsExpression(init)) init = init.expression;
      if (ts.isStringLiteral(init)) consts.set(node.name.text, init.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return consts;
}

/** 이벤트명 인자를 문자열로 푼다. 풀 수 없으면 undefined. */
function resolveEventName(node, consts) {
  if (!node) return undefined;
  let n = node;
  while (ts.isAsExpression(n)) n = n.expression;
  if (ts.isStringLiteral(n)) return n.text;
  if (ts.isIdentifier(n)) return consts.get(n.text);
  return undefined;
}

/**
 * `EventPayloadOf<typeof PAYMENT_STREAM, 'PaymentCaptured'>` 를 분해한다.
 * 도출 타입이 아니면 null.
 */
function parseDerivedType(typeNode) {
  if (!typeNode || !ts.isTypeReferenceNode(typeNode)) return null;

  const name = typeNode.typeName.getText();
  if (name !== 'EventPayloadOf' && name !== 'EnvelopeOf') return null;

  const args = typeNode.typeArguments ?? [];
  if (args.length !== 2) return { kind: name, stream: undefined, event: undefined };

  // 1번째: `typeof STREAM`
  const streamArg = args[0];
  const stream =
    ts.isTypeQueryNode(streamArg) ? streamArg.exprName.getText() : undefined;

  // 2번째: `'EventName'`
  const eventArg = args[1];
  const event =
    ts.isLiteralTypeNode(eventArg) && ts.isStringLiteral(eventArg.literal) ? eventArg.literal.text : undefined;

  return { kind: name, stream, event };
}

function scanFile(rel) {
  const abs = path.join(REPO, rel);
  const source = ts.createSourceFile(abs, fs.readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true);
  const consts = collectStringConsts(source);
  const findings = [];
  const handlers = [];

  const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart()).line + 1;

  const visit = (node) => {
    if (ts.isMethodDeclaration(node)) {
      const ds = decoratorsOf(node);
      const handler = ds.find((d) => d.name === 'On' || d.name === 'OnEvent');
      if (handler) {
        const where = `${rel}:${lineOf(node)}`;
        const method = `${node.parent && node.parent.name ? node.parent.name.getText() : '?'}.${node.name.getText()}`;

        if (handler.name === 'OnEvent') {
          handlers.push({ where, method, migrated: false });
          findings.push({
            code: 'LEGACY',
            where,
            method,
            detail: '@OnEvent 은 토픽·이벤트명이 생문자열이다. @On(STREAM, "Event") 로 이주하라 (ADR-0029 §4).',
          });
        } else {
          const streamArg = handler.args[0];
          const stream = streamArg && ts.isIdentifier(streamArg) ? streamArg.text : streamArg?.getText();
          const event = resolveEventName(handler.args[1], consts);
          handlers.push({ where, method, migrated: true, stream, event });

          if (event === undefined) {
            findings.push({
              code: 'UNRESOLVED_EVENT',
              where,
              method,
              detail: `@On 의 이벤트명을 정적으로 풀 수 없다 (${handler.args[1]?.getText() ?? '<없음>'}). ` +
                '리터럴이거나 같은 파일의 문자열 상수여야 이 게이트가 검사할 수 있다.',
            });
          }

          for (const param of node.parameters) {
            const pd = decoratorsOf(param);
            const marker = pd.find((d) => DERIVED_TYPE_FOR[d.name]);
            if (!marker) continue;

            const expectedKind = DERIVED_TYPE_FOR[marker.name];
            const derived = parseDerivedType(param.type);
            const paramName = param.name.getText();

            if (!derived) {
              findings.push({
                code: 'UNDERIVED',
                where,
                method,
                detail:
                  `@${marker.name}() ${paramName}: ${param.type ? param.type.getText().replace(/\s+/g, ' ') : '<타입 없음>'} — ` +
                  `${expectedKind}<typeof ${stream ?? 'STREAM'}, '${event ?? 'Event'}'> 로 도출하라. ` +
                  '손으로 단 주석은 계약과 어긋나도 조용하다.',
              });
              continue;
            }

            if (derived.kind !== expectedKind) {
              findings.push({
                code: 'WRONG_DERIVED_TYPE',
                where,
                method,
                detail: `@${marker.name}() ${paramName} 에 ${derived.kind} 가 쓰였다 — ${expectedKind} 여야 한다.`,
              });
              continue;
            }

            if (derived.stream === undefined || derived.event === undefined) {
              findings.push({
                code: 'UNRESOLVED_DERIVED',
                where,
                method,
                detail: `@${marker.name}() ${paramName} 의 ${derived.kind}<...> 인자를 정적으로 풀 수 없다. ` +
                  `${expectedKind}<typeof STREAM, 'EventName'> 형태여야 한다.`,
              });
              continue;
            }

            if (stream !== undefined && derived.stream !== stream) {
              findings.push({
                code: 'STREAM_MISMATCH',
                where,
                method,
                detail: `@On 은 ${stream} 인데 @${marker.name}() ${paramName} 은 ${derived.stream} 에서 도출한다.`,
              });
            }

            if (event !== undefined && derived.event !== event) {
              findings.push({
                code: 'EVENT_MISMATCH',
                where,
                method,
                detail:
                  `@On(${stream}, '${event}') 인데 @${marker.name}() ${paramName} 은 '${derived.event}' 에서 도출한다. ` +
                  '둘 중 하나가 틀렸고, 타입은 이것을 잡지 못한다.',
              });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return { findings, handlers };
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const allowLegacy = argv.includes('--allow-legacy');
  const apps = argv.filter((a) => !a.startsWith('--'));

  const scope = apps.length ? apps.map((a) => `apps/${a}`).join(' ') : 'apps';
  let files = [];
  try {
    files = execSync(`grep -rlE "@(On|OnEvent)\\(" ${scope} --include=*.ts | grep -v '\\.spec\\.' | sort`, {
      cwd: REPO,
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    files = [];
  }

  const findings = [];
  const handlers = [];
  for (const rel of files) {
    const result = scanFile(rel);
    findings.push(...result.findings);
    handlers.push(...result.handlers);
  }

  const reported = allowLegacy ? findings.filter((f) => f.code !== 'LEGACY') : findings;
  const legacy = findings.filter((f) => f.code === 'LEGACY').length;
  const migrated = handlers.filter((h) => h.migrated).length;

  if (json) {
    console.log(JSON.stringify({ handlers: handlers.length, migrated, legacy, findings: reported }, null, 2));
  } else {
    console.log(`이벤트 핸들러 ${handlers.length}개 (파일 ${files.length}) — @On ${migrated} / @OnEvent ${legacy}`);
    if (reported.length === 0) {
      console.log('발견 없음.');
    } else {
      const byCode = new Map();
      for (const f of reported) byCode.set(f.code, [...(byCode.get(f.code) ?? []), f]);
      for (const [code, list] of byCode) {
        console.log(`\n[${code}] ${list.length}건`);
        for (const f of list) console.log(`  ${f.where}  ${f.method}\n    ${f.detail}`);
      }
    }
    if (allowLegacy && legacy > 0) console.log(`\n(--allow-legacy: @OnEvent 잔량 ${legacy}건 무시)`);
  }

  process.exit(reported.length > 0 ? 1 : 0);
}

main();
