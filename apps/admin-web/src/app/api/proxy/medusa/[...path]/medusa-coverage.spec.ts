import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { MEDUSA_PERMISSIONS, requiredForMedusa } from './medusa-permissions';

/**
 * admin-web 이 Medusa 를 부르는 곳(`${MEDUSA_BASE_URL}/…`)을 소스에서 모아, 전부 프록시 권한표에 있는지 본다.
 * 표에 없으면 프록시가 403 을 주므로, 새 호출을 만들면 여기서 먼저 걸린다.
 */
const SRC = join(__dirname, '..', '..', '..', '..', '..');

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.spec\./.test(name)) out.push(p);
  }
  return out;
}

interface Call { method: string; path: string[]; at: string }

function medusaCalls(file: string): Call[] {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const out: Call[] = [];
  const consts = new Map<string, string>();
  const textOf = (e: ts.Expression): string | null => {
    if (ts.isNoSubstitutionTemplateLiteral(e) || ts.isStringLiteral(e)) return e.text;
    if (ts.isTemplateExpression(e)) {
      let s = e.head.text;
      for (const span of e.templateSpans) {
        const id = ts.isIdentifier(span.expression) ? span.expression.text : null;
        s += (id === 'MEDUSA_BASE_URL' ? '@MEDUSA' : id && consts.has(id) ? consts.get(id) : ':p') + span.literal.text;
      }
      return s;
    }
    if (ts.isIdentifier(e)) return consts.get(e.text) ?? null;
    return null;
  };
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const t = textOf(n.initializer);
      if (t?.startsWith('@MEDUSA')) consts.set(n.name.text, t);
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && /^(get|post|put|patch|delete)$/.test(n.expression.name.text) && n.arguments[0]) {
      const t = textOf(n.arguments[0]);
      if (t?.startsWith('@MEDUSA')) {
        // `${qs}` 처럼 세그먼트 끝에 붙은 보간은 쿼리 문자열이다 — 떼어 낸다. 세그먼트 전체가 보간이면 경로 변수.
        const path = t.slice('@MEDUSA'.length).split('?')[0].split('/').filter(Boolean).map((seg) => (seg === ':p' ? seg : seg.replace(/:p$/, '')));
        out.push({ method: n.expression.name.text.toUpperCase(), path, at: `${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}` });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const calls = files(SRC).flatMap(medusaCalls);

describe('Medusa 프록시 권한표', () => {
  it('검사가 실제로 호출을 찾는다', () => {
    expect(calls.length).toBeGreaterThan(30);
  });

  it('admin-web 이 부르는 Medusa 경로는 전부 표에 있다', () => {
    expect(calls.filter((c) => requiredForMedusa(c.method, c.path) === null).map((c) => `${c.method} /${c.path.join('/')} (${c.at})`)).toEqual([]);
  });

  it('표의 규칙은 실제로 부르는 조합만 연다', () => {
    const fits = (pattern: string, path: string[]) => {
      const parts = pattern.split('/');
      return parts.length === path.length && parts.every((part, i) => part.startsWith(':') || part === path[i]);
    };
    const unused = MEDUSA_PERMISSIONS.filter((r) => !calls.some((c) => c.method === r.method && fits(r.pattern, c.path)));
    expect(unused.map((r) => `${r.method} ${r.pattern}`)).toEqual([]);
  });
});
