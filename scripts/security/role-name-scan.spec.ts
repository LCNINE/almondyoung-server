import { countRoleLiterals, nonLiteralCheckpointCalls } from './role-name-scan';

describe('역할 이름 검사기', () => {
  it('따옴표 종류·줄바꿈·상수 추출과 상관없이 역할 이름 문자열을 센다', () => {
    const source = [
      "if (roles.includes('admin')) return true;",
      'if (roles.includes("admin")) return true;',
      'roles.includes(\n  `admin`,\n);',
      "const role = 'logistics_manager';",
    ].join('\n');
    expect(countRoleLiterals(source)).toBe(4);
  });

  it('주석과 역할이 아닌 문자열은 세지 않는다', () => {
    const source = "// roles.includes('admin')\n/* 'master' */\nconst label = 'administrator';";
    expect(countRoleLiterals(source)).toBe(0);
  });

  it('판정 지점 이름이 리터럴이 아닌 호출을 찾는다 — 여러 줄 호출도', () => {
    const source = [
      "this.checkpoints.compare('a.b', true, subject, []);",
      'this.checkpoints.compare(\n  point,\n  legacy,\n  subject,\n  [],\n);',
      'this.checkpoints.compareDecision(`work.${id}`, true, request, []);',
      'other.compare(point, 1);',
    ].join('\n');
    expect(nonLiteralCheckpointCalls(source)).toEqual([2, 8]);
  });
});
