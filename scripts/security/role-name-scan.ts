import * as ts from 'typescript';

/** 역할 이름. 코드가 이 문자열을 들고 있으면 역할 이름으로 판정할 수 있다는 뜻이라 개수를 센다. */
export const ROLE_NAMES: ReadonlySet<string> = new Set([
  'master',
  'admin',
  'intern',
  'logistics_worker',
  'logistics_manager',
]);

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile('scan.ts', source, ts.ScriptTarget.Latest, true);
}

/**
 * 역할 이름과 똑같은 문자열 리터럴의 개수. 따옴표 종류·줄바꿈·상수 추출과 상관없이 센다(구문 트리 기준이라
 * 주석은 세지 않는다). 판정인지 데이터 값인지는 가리지 않는다 — 그건 기준 목록의 «종류»가 적는다.
 */
export function countRoleLiterals(source: string): number {
  let count = 0;
  const visit = (node: ts.Node): void => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && ROLE_NAMES.has(node.text)) count += 1;
    node.forEachChild(visit);
  };
  parse(source).forEachChild(visit);
  return count;
}

/**
 * `checkpoints.compare(...)`·`checkpoints.compareDecision(...)` 가운데 첫 인자(판정 지점 이름)가 문자열 리터럴이
 * 아닌 호출의 줄 번호(1부터). 판정 지점 이름은 지표 라벨이라 값의 수가 코드로 정해져야 한다.
 */
export function nonLiteralCheckpointCalls(source: string): number[] {
  const file = parse(source);
  const lines: number[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      (node.expression.name.text === 'compare' || node.expression.name.text === 'compareDecision') &&
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
