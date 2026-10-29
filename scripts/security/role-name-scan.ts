import * as ts from 'typescript';

/** 역할 이름. 코드가 이 문자열을 들고 있으면 역할 이름으로 판정할 수 있다는 뜻이라 개수를 센다. */
export const ROLE_NAMES: ReadonlySet<string> = new Set([
  'master',
  'admin',
  'intern',
  'logistics_worker',
  'logistics_manager',
]);

/** 고객 계정이 갖는 역할 이름. 직원 판정의 반대편(고객이 아닌 역할 = 직원)을 코드가 이름으로 아는 자리라 센다. */
export const CUSTOMER_ROLE_NAMES: ReadonlySet<string> = new Set(['user', 'membership']);

/** 역할 이름을 담는 자리의 이름(`roleName`·`roleNames`·`ROLE_NAMES`·`roles.name`). 채팅 `role: 'user'` 같은 다른 뜻의 role 은 제외한다. */
const ROLE_NAME_SLOT = /roleNames?\b|role_names?\b|ROLE_NAMES?\b|\broles\.name\b|\broles\b/;

/** 파일 이름의 확장자로 TS/TSX 를 고른다 — 화면(.tsx)을 .ts 로 읽으면 JSX 텍스트에서 파싱이 어긋난다. */
function parse(source: string, fileName = 'scan.ts'): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
}

/**
 * 역할 이름과 똑같은 문자열 리터럴의 개수. 따옴표 종류·줄바꿈·상수 추출과 상관없이 센다(구문 트리 기준이라
 * 주석은 세지 않는다). 판정인지 데이터 값인지는 가리지 않는다 — 그건 기준 목록의 «종류»가 적는다.
 */
export function countRoleLiterals(source: string, fileName?: string): number {
  const file = parse(source, fileName);
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      // 'admin,master' 처럼 쉼표로 합친 문자열은 조각마다 역할 이름이다.
      count += node.text.split(',').filter((piece) => ROLE_NAMES.has(piece.trim())).length;
      const customerPieces = node.text.split(',').filter((piece) => CUSTOMER_ROLE_NAMES.has(piece.trim())).length;
      if (customerPieces > 0 && inRoleNameSlot(node, file)) count += customerPieces;
    }
    node.forEachChild(visit);
  };
  file.forEachChild(visit);
  return count;
}

/** 고객 역할 이름 리터럴이 «역할 이름 자리»(역할과의 비교·역할 이름 인자·roleName 속성·역할 상수)에 있는지. */
function inRoleNameSlot(literal: ts.Node, file: ts.SourceFile): boolean {
  let node: ts.Node = literal;
  while (
    node.parent &&
    (ts.isArrayLiteralExpression(node.parent) ||
      ts.isParenthesizedExpression(node.parent) ||
      ts.isAsExpression(node.parent))
  ) {
    node = node.parent;
  }
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isBinaryExpression(parent)) {
    const op = parent.operatorToken.kind;
    const equality =
      op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      op === ts.SyntaxKind.EqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsToken;
    const other = parent.left === node ? parent.right : parent.left;
    return equality && ROLE_NAME_SLOT.test(other.getText(file));
  }
  if (ts.isCallExpression(parent)) {
    const callee = parent.expression.getText(file);
    if (/role/i.test(callee)) return true;
    return parent.arguments.some((arg) => arg !== node && ROLE_NAME_SLOT.test(arg.getText(file)));
  }
  if (ts.isPropertyAssignment(parent) || ts.isVariableDeclaration(parent))
    return ROLE_NAME_SLOT.test(parent.name.getText(file));
  return false;
}

/**
 * `checkpoints.check(...)`·`checkpoints.checkRoute(...)` 가운데 첫 인자(판정 지점 이름)가 문자열 리터럴이
 * 아닌 호출의 줄 번호(1부터). 판정 지점 이름은 지표 라벨이라 값의 수가 코드로 정해져야 한다.
 */
export function nonLiteralCheckpointCalls(source: string, fileName?: string): number[] {
  const file = parse(source, fileName);
  const lines: number[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      (node.expression.name.text === 'check' || node.expression.name.text === 'checkRoute') &&
      /(^|\.)checkpoints$/.test(node.expression.expression.getText(file))
    ) {
      const first = node.arguments[0];
      if (!first || !ts.isStringLiteral(first)) {
        lines.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
      }
    }
    node.forEachChild(visit);
  };
  file.forEachChild(visit);
  return lines;
}
