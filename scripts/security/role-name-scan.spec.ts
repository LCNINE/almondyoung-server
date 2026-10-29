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
      "this.checkpoints.check('a.b', subject, []);",
      'this.checkpoints.check(\n  point,\n  subject,\n  [],\n);',
      'this.checkpoints.checkRoute(`work.${id}`, request, []);',
      'other.check(point, 1);',
    ].join('\n');
    expect(nonLiteralCheckpointCalls(source)).toEqual([2, 7]);
  });

  it('화면 파일(.tsx)은 JSX 로 읽어 그 안의 역할 이름 문자열도 센다', () => {
    // JSX 텍스트의 작은따옴표(Don't)를 .ts 로 읽으면 문자열 시작으로 오해해 뒤의 'admin' 을 놓친다.
    const source = "export const A = () => <p>Don't {role === 'admin' ? 1 : 0}</p>;";
    expect(countRoleLiterals(source, 'screen.tsx')).toBe(1);
  });

  it('쉼표로 합친 역할 문자열은 조각마다 센다', () => {
    expect(countRoleLiterals("const roleName = 'admin,master';")).toBe(2);
    expect(countRoleLiterals("const roleName = 'admin, intern, other';")).toBe(2);
    expect(countRoleLiterals("const label = 'a,b';")).toBe(0);
  });

  it('고객 역할 이름은 역할 이름 자리에서만 센다 — 채팅 role 같은 다른 뜻은 세지 않는다', () => {
    const slots = [
      "if (roles.includes('user')) {}",
      "const hit = roleName === 'membership';",
      "where(eq(schema.roles.name, 'user'));",
      "const CUSTOMER_ROLE_NAMES = ['user', 'membership'];",
      "find({ roleName: 'user' });",
      "this.findByRoleName('user');",
    ];
    expect(slots.map((s) => countRoleLiterals(s))).toEqual([1, 1, 1, 2, 1, 1]);
    expect(countRoleLiterals("const roleNames = 'user,membership';")).toBe(2);
    expect(countRoleLiterals("const label = 'user,membership';")).toBe(0);
    const others = [
      "const m = { role: 'user' };",
      "if (message.role === 'user') {}",
      "const t = { type: 'user' };",
      "key('membership')",
    ];
    expect(others.map((s) => countRoleLiterals(s))).toEqual([0, 0, 0, 0]);
  });
});
