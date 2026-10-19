import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import * as ts from 'typescript';

/**
 * K2 — 상자(shipments)의 상태와 구성(shipment_lines)을 쓰는 길은 커널(`modules/fulfillment/shipment/`)의 전이 함수와
 * 구성 편집의 문 하나뿐이다. 호출자가 `tx.update(shipments).set({ status })` 를 직접 쓰기 시작하면 (1) 전이표 검증,
 * (2) 재개봉 리셋·버전 증가 규칙, (3) 커스터디·송장 가드 순서가 다시 호출자마다 복사되어 갈린다.
 * 이 가드는 «커널 밖에서 상자를 insert·delete 하거나, 허용 목록 밖의 키를 update 하거나, 별칭(update·insert·delete 인자로 쓰이거나 export 되는 것)·raw SQL 로 우회하는 곳이
 * 없다»를 지킨다. 허용 목록은 파일 경로 단위다 — 예약 버전·출입 비밀번호 비움·검수 흔적처럼 상태가 아닌 부수 필드만 연다.
 * 알려진 한계: 구조분해한 tx 의 별칭 호출, 문자열을 조립해 만든 SQL 은 잡지 못한다.
 */
const ROOT = join(__dirname, '../../../../../..');
const SRC = join(ROOT, 'apps/core/src');
const MODULES = 'apps/core/src/modules/';
const KERNEL = 'apps/core/src/modules/fulfillment/shipment/';

const RESERVATION = 'fulfillment/services/shipment-reservation.service.ts';
const DISPATCH = 'fulfillment/services/shipment-dispatch.service.ts';
const BOX_ALLOCATION = 'fulfillment/services/box-allocation.manager.ts';
const TRACKING = 'fulfillment/services/shipment-delivery-tracking.service.ts';
const PASSWORD_CLEANER = 'sales-order/services/entrance-password-cleaner.ts';

const RAW_SQL = /\b(update|insert\s+into|delete\s+from)\s+"?shipment(s|_lines)\b/i;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__support__' ? [] : walk(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

type Table = 'shipments' | 'shipmentLines';
type Aliases = Map<string, Table>;

function tableOf(node: ts.Expression | undefined, aliases: Aliases): Table | null {
  if (!node) return null;
  let cur = node;
  while (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isNonNullExpression(cur))
    cur = cur.expression;
  if (ts.isPropertyAccessExpression(cur)) {
    if (cur.name.text === 'shipments') return 'shipments';
    if (cur.name.text === 'shipmentLines') return 'shipmentLines';
  }
  if (ts.isIdentifier(cur)) return aliases.get(cur.text) ?? null;
  return null;
}

/** 파일 안에서 `<x>.shipments`·`<x>.shipmentLines` 로 초기화된 식별자(구조분해 포함). 선언 자체는 위반이 아니다. */
function collectAliases(src: ts.SourceFile): Aliases {
  const aliases: Aliases = new Map();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name)) {
        const table = tableOf(node.initializer, new Map());
        if (table) aliases.set(node.name.text, table);
      } else if (
        ts.isObjectBindingPattern(node.name) &&
        (ts.isIdentifier(node.initializer) || ts.isPropertyAccessExpression(node.initializer))
      ) {
        for (const el of node.name.elements) {
          const key = (el.propertyName ?? el.name).getText(src);
          if ((key === 'shipments' || key === 'shipmentLines') && ts.isIdentifier(el.name))
            aliases.set(el.name.text, key);
        }
      }
    }
    node.forEachChild(visit);
  };
  visit(src);
  return aliases;
}

function callName(node: ts.CallExpression): string | null {
  return ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : null;
}

/** 키 → 허용 파일(모듈 기준 상대 경로). */
type Allow = Record<string, string[]>;
const SHIPMENTS_KEYS: Allow = { reservationVersion: [RESERVATION] };
const LINES_KEYS: Allow = {
  reservedQty: [RESERVATION],
  lineVersion: [RESERVATION, DISPATCH, BOX_ALLOCATION],
  inspectedQty: [DISPATCH, BOX_ALLOCATION],
  forced: [DISPATCH, BOX_ALLOCATION],
};

function checkSet(table: Table, arg: ts.Expression | undefined, rel: string, where: string, out: string[]): void {
  if (!arg) return;
  let patch = arg;
  while (ts.isParenthesizedExpression(patch) || ts.isAsExpression(patch) || ts.isSatisfiesExpression(patch)) {
    patch = patch.expression;
  }
  if (!ts.isObjectLiteralExpression(patch)) {
    out.push(`${where} — ${table} update 의 set 이 객체 리터럴이 아니다`);
    return;
  }
  for (const p of patch.properties) {
    if (ts.isSpreadAssignment(p)) {
      out.push(`${where} — ${table} update 의 set 에 스프레드가 있다`);
      continue;
    }
    const name = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) ? p.name.text : null;
    if (name === null) {
      out.push(`${where} — ${table} update 의 키가 정적으로 풀리지 않는다`);
      continue;
    }
    if (table === 'shipments') {
      if (name === 'lastUpdated') continue;
      if (name === 'entrancePassword') {
        const isNull = ts.isPropertyAssignment(p) && p.initializer.kind === ts.SyntaxKind.NullKeyword;
        if (isNull && [TRACKING, PASSWORD_CLEANER].includes(rel)) continue;
        out.push(`${where} — shipments.entrancePassword 는 null 로만, 허용 파일에서만 쓴다`);
        continue;
      }
      if (!(SHIPMENTS_KEYS[name] ?? []).includes(rel)) out.push(`${where} — shipments.${name} 를 커널 밖에서 쓴다`);
    } else if (!(LINES_KEYS[name] ?? []).includes(rel)) {
      out.push(`${where} — shipmentLines.${name} 를 이 파일에서 쓴다`);
    }
  }
}

function violationsIn(path: string): string[] {
  const rel = relative(join(ROOT, MODULES), path);
  const file = relative(ROOT, path);
  const src = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const aliases = collectAliases(src);
  const at = (node: ts.Node) => `${file}:${src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1}`;

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = callName(node);
      const table = tableOf(node.arguments[0], aliases);
      if ((name === 'insert' || name === 'delete') && table) {
        out.push(`${at(node)} — ${table} 를 ${name} 한다`);
      }
      if (name === 'update' && table) {
        const parent = node.parent;
        const setCall = ts.isPropertyAccessExpression(parent) && parent.name.text === 'set' ? parent.parent : null;
        if (setCall && ts.isCallExpression(setCall)) checkSet(table, setCall.arguments[0], rel, at(node), out);
        else out.push(`${at(node)} — ${table} update 뒤에 곧바로 .set(...) 이 오지 않는다`);
      }
    }
    // 별칭을 export 하면 파일 경계를 넘어 쓰인다 — 넘어간 쪽은 해석하지 않으므로 닫힌 쪽으로 위반.
    if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) &&
      node.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && aliases.has(d.name.text))
    ) {
      out.push(`${at(node)} — 상자 테이블 별칭을 export 한다`);
    }
    if (ts.isExportSpecifier(node) && aliases.has((node.propertyName ?? node.name).text)) {
      out.push(`${at(node)} — 상자 테이블 별칭을 export 한다`);
    }
    if (ts.isExportAssignment(node) && ts.isIdentifier(node.expression) && aliases.has(node.expression.text)) {
      out.push(`${at(node)} — 상자 테이블 별칭을 export 한다`);
    }
    const text =
      ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
        ? node.text
        : null;
    if (text !== null && RAW_SQL.test(text)) out.push(`${at(node)} — raw SQL 로 상자를 쓴다`);
    node.forEachChild(visit);
  };
  visit(src);
  return out;
}

describe('K2 상자 쓰기 우회 금지', () => {
  const files = walk(SRC).filter((path) => !relative(ROOT, path).startsWith(KERNEL));

  it('걷기가 비어 있지 않다', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((path) => path.endsWith('shipment-dispatch.service.ts'))).toBe(true);
  });

  it('커널 밖에서 상자의 상태·구성을 직접 쓰는 곳이 없다', () => {
    expect(files.flatMap(violationsIn).sort()).toEqual([]);
  });
});
