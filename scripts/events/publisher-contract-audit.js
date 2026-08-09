#!/usr/bin/env node
/**
 * 이벤트 **발행** 주입 지점의 계약 도출 일관성 전수 감사 (ADR-0029 §4, 플랜 Task 6-B).
 *
 * `event-handler-contract-audit.js` 의 발행 쪽 형제다. 소비 쪽에서 5-A 가 배운 것과
 * **같은 함정이 발행 쪽에 있다** — 스트림이 두 번 이름 붙고, 어긋나도 컴파일된다:
 *
 *   @InjectPublisher(ORDER_STREAM) p: PublisherFor<typeof PRODUCT_STREAM>
 *   //               ^^^^^^^^^^^^ DI 토큰이 나오는 곳      ^^^^^^^^^^^^^^ 타입이 나오는 곳
 *
 * `InjectPublisher` 는 `Inject(getPublisherToken(stream.topic.topic))` 만 돌려주므로
 * 타입 파라미터와 아무 관계가 없다. 위 코드는 **orders 토픽 publisher 를 쥔 채 PRODUCT
 * 이벤트를 발행**하고, `publishEvent` 의 `validatePayload` 는 `streamConfig.events[eventType]`
 * 를 못 찾으면 warn 만 하고 통과시킨다(`stream-publisher.service.ts`). 즉 **조용히 잘못된
 * 토픽으로 나간다** — 이 워크스트림이 반복해서 만난 "가장 치명적인 실수가 가장 조용하다".
 *
 * 왜 타입으로 못 막는가 — 데코레이터는 파라미터 타입을 볼 수 없다. `Inject()` 의 반환은
 * `ParameterDecorator` 이고 그 시그니처에 파라미터 타입이 들어오지 않는다. 제네릭으로
 * 묶으려면 주입을 데코레이터가 아니라 팩토리로 바꿔야 하고, 그건 Nest 생성자 주입을
 * 포기하는 것이다(ADR-0029 "명시적으로 하지 않는 것" 의 핸들러 레코드와 같은 이유).
 *
 * 왜 AST 인가 — 여러 줄 데코레이터와 `@Optional()` 같은 동반 데코레이터가 흔해 정규식은
 * 파라미터를 통째로 놓친다. 선례: `scripts/security/route-authz-audit.js` (정규식 집계가
 * 무방비 쓰기를 105건으로 과소집계했다가 실제 207건이었다).
 *
 * 이 게이트는 **순수 구문 검사**다. 스트림 상수가 실재하는지, 그 스트림이 앱의
 * `forRoot({streams})` 에 들어 있는지는 검사하지 않는다 — 앞의 것은 컴파일이, 뒤의 것은
 * 부팅 시 DI 실패가 이미 시끄럽게 잡는다(ADR-0029 Consequences 표). 여기서 또 검사하면
 * 계약 로딩이라는 두 번째 진실이 생긴다.
 *
 * 사용법:
 *   node scripts/events/publisher-contract-audit.js            # apps + libs
 *   node scripts/events/publisher-contract-audit.js --json     # 기계 판독용
 *   node scripts/events/publisher-contract-audit.js --root tmp/fixtures   # 변이 테스트용
 *
 * 종료 코드: 발견이 하나라도 있으면 1.
 */
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');

/** 토큰 문자열 형식. 소유자는 `libs/events/src/publishers/publisher-token.ts` 하나뿐이다. */
const TOKEN_PREFIX = 'STREAM_PUBLISHER_';

/** 토큰을 만드는 함수 이름들. 파라미터 데코레이터에서 이걸 직접 부르면 도출을 우회한 것이다. */
const TOKEN_FACTORIES = new Set(['getPublisherToken', 'EventsModule.getPublisherToken']);

const decoratorsOf = (node) =>
  (ts.getDecorators(node) ?? []).map((d) => {
    const e = d.expression;
    return ts.isCallExpression(e)
      ? { name: e.expression.getText(), args: [...e.arguments] }
      : { name: e.getText(), args: [] };
  });

/**
 * 스트림을 가리키는 식(識)을 텍스트로 만든다. 식별자(`ORDER_STREAM`)와 프로퍼티 접근
 * (`Streams.ORDER`)만 허용한다 — 호출·조건식 등은 정적으로 대조할 수 없으므로 통과시키지
 * 않는다(통과시키면 이 게이트가 조용히 비어버린다).
 */
function streamRefText(node) {
  if (!node) return undefined;
  let n = node;
  while (ts.isAsExpression(n) || ts.isParenthesizedExpression(n)) n = n.expression;
  if (ts.isIdentifier(n) || ts.isPropertyAccessExpression(n)) return n.getText();
  return undefined;
}

/**
 * `PublisherFor<typeof ORDER_STREAM>` 을 분해한다.
 * - `null`  : `PublisherFor<...>` 자체가 아니다 (옛 `StreamPublisher<XEvents>` 등)
 * - `{stream: undefined}` : `PublisherFor` 이지만 `typeof IDENT` 로 안 적혔다
 */
function parsePublisherFor(typeNode) {
  if (!typeNode) return null;

  let n = typeNode;
  // `PublisherFor<typeof S> | undefined` 같은 union 에서 PublisherFor 갈래를 고른다.
  if (ts.isUnionTypeNode(n)) {
    const candidate = n.types.find(
      (t) => ts.isTypeReferenceNode(t) && t.typeName.getText() === 'PublisherFor',
    );
    if (candidate) n = candidate;
  }

  if (!ts.isTypeReferenceNode(n) || n.typeName.getText() !== 'PublisherFor') return null;

  const args = n.typeArguments ?? [];
  if (args.length !== 1) return { stream: undefined };

  const arg = args[0];
  return { stream: ts.isTypeQueryNode(arg) ? arg.exprName.getText() : undefined };
}

function scanFile(rel) {
  const abs = path.isAbsolute(rel) ? rel : path.join(REPO, rel);
  const source = ts.createSourceFile(abs, fs.readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true);
  const findings = [];
  const injections = [];

  const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart()).line + 1;

  const visit = (node) => {
    // ── 손으로 적은 토큰 문자열 ────────────────────────────────────────────────
    // provide 쪽이든 주입 쪽이든, 문자열을 손으로 적으면 형식이 두 벌이 된다.
    if (ts.isStringLiteral(node) && node.text.startsWith(TOKEN_PREFIX)) {
      findings.push({
        code: 'HARDCODED_TOKEN',
        where: `${rel}:${lineOf(node)}`,
        method: '—',
        detail:
          `'${node.text}' — publisher 토큰 문자열을 손으로 적었다. ` +
          '`getPublisherToken(STREAM.topic.topic)` 으로 도출하라. 형식의 소유자는 ' +
          '`libs/events/src/publishers/publisher-token.ts` 하나다 (ADR-0029 §4).',
      });
    }

    if (ts.isParameter(node)) {
      const ds = decoratorsOf(node);
      const owner = node.parent;
      const cls = owner && owner.parent && owner.parent.name ? owner.parent.name.getText() : '?';
      const paramName = node.name.getText();
      const where = `${rel}:${lineOf(node)}`;
      const method = `${cls}.constructor(${paramName})`;

      const legacy = ds.find((d) => d.name === 'InjectStreamPublisher');
      if (legacy) {
        injections.push({ where, method, migrated: false });
        findings.push({
          code: 'LEGACY',
          where,
          method,
          detail:
            '@InjectStreamPublisher 는 토픽 문자열과 이벤트 타입 제네릭을 따로 적게 한다. ' +
            '@InjectPublisher(STREAM) + PublisherFor<typeof STREAM> 으로 이주하라 (ADR-0029 §4).',
        });
      }

      // `@Inject(getPublisherToken(...))` — 도출 표면을 지나지 않는 우회.
      const rawInject = ds.find(
        (d) =>
          d.name === 'Inject' &&
          d.args.length === 1 &&
          ts.isCallExpression(d.args[0]) &&
          TOKEN_FACTORIES.has(d.args[0].expression.getText()),
      );
      if (rawInject) {
        injections.push({ where, method, migrated: false });
        findings.push({
          code: 'RAW_TOKEN',
          where,
          method,
          detail:
            `@Inject(${rawInject.args[0].getText()}) — 토큰을 직접 만들어 주입하면 타입과 스트림이 ` +
            '아무 데서도 대조되지 않는다. @InjectPublisher(STREAM) 을 쓰라 (같은 토큰이 나온다).',
        });
      }

      const inject = ds.find((d) => d.name === 'InjectPublisher');
      if (!inject) {
        ts.forEachChild(node, visit);
        return;
      }

      const declared = streamRefText(inject.args[0]);
      injections.push({ where, method, migrated: true, stream: declared });

      if (declared === undefined) {
        findings.push({
          code: 'UNRESOLVED_STREAM',
          where,
          method,
          detail:
            `@InjectPublisher(${inject.args[0]?.getText() ?? '<없음>'}) — 스트림 인자를 정적으로 풀 수 없다. ` +
            '계약 상수를 직접 넘겨야 이 게이트가 타입과 대조할 수 있다.',
        });
      }

      const derived = parsePublisherFor(node.type);
      const typeText = node.type ? node.type.getText().replace(/\s+/g, ' ') : '<타입 없음>';

      if (!derived) {
        findings.push({
          code: 'UNDERIVED',
          where,
          method,
          detail:
            `${paramName}: ${typeText} — PublisherFor<typeof ${declared ?? 'STREAM'}> 로 도출하라. ` +
            '손으로 고른 이벤트 제네릭은 데코레이터와 어긋나도 조용하다.',
        });
      } else if (derived.stream === undefined) {
        findings.push({
          code: 'UNRESOLVED_DERIVED',
          where,
          method,
          detail: `${paramName}: ${typeText} — PublisherFor<typeof STREAM> 형태여야 정적으로 대조할 수 있다.`,
        });
      } else if (declared !== undefined && derived.stream !== declared) {
        findings.push({
          code: 'STREAM_MISMATCH',
          where,
          method,
          detail:
            `@InjectPublisher(${declared}) 인데 ${paramName} 은 PublisherFor<typeof ${derived.stream}> 이다. ` +
            `런타임에는 ${declared} 의 publisher 가 주입되고 ${derived.stream} 의 이벤트를 발행하게 된다 — ` +
            'validatePayload 는 모르는 eventType 을 warn 후 통과시키므로 잘못된 토픽으로 조용히 나간다.',
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
  return { findings, injections };
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const rootIdx = argv.indexOf('--root');
  const roots = rootIdx >= 0 ? [argv[rootIdx + 1]] : ['apps', 'libs'];

  let files = [];
  try {
    files = execSync(
      `grep -rlE "@Inject(Stream)?Publisher\\(|@Inject\\(|${TOKEN_PREFIX}" ${roots.join(' ')} --include=*.ts ` +
        `| grep -v '\\.spec\\.' | sort`,
      { cwd: REPO, encoding: 'utf8' },
    )
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    files = [];
  }

  const findings = [];
  const injections = [];
  for (const rel of files) {
    const result = scanFile(rel);
    findings.push(...result.findings);
    injections.push(...result.injections);
  }

  const migrated = injections.filter((i) => i.migrated).length;

  if (json) {
    console.log(JSON.stringify({ injections: injections.length, migrated, findings }, null, 2));
  } else {
    console.log(
      `발행 주입 지점 ${injections.length}개 (스캔 파일 ${files.length}) — ` +
        `@InjectPublisher ${migrated} / 옛 표면 ${injections.length - migrated}`,
    );
    if (findings.length === 0) {
      console.log('발견 없음.');
    } else {
      const byCode = new Map();
      for (const f of findings) byCode.set(f.code, [...(byCode.get(f.code) ?? []), f]);
      for (const [code, list] of byCode) {
        console.log(`\n[${code}] ${list.length}건`);
        for (const f of list) console.log(`  ${f.where}  ${f.method}\n    ${f.detail}`);
      }
    }
  }

  process.exit(findings.length > 0 ? 1 : 0);
}

main();
