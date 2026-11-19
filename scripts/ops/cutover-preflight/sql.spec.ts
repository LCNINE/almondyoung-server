import * as fs from 'fs';
import * as path from 'path';
import { fillVars, parseSqlArgs } from './sql';

describe('cutover sql.ts 인자', () => {
  it('-e 와 --db 를 받는다', () => {
    expect(parseSqlArgs(['--db', 'core', '-e', 'select 1'])).toEqual({ db: 'core', sql: 'select 1', vars: {} });
  });

  it('파일을 읽고 {{이름}} 을 --set 값으로 채운다', () => {
    const r = parseSqlArgs(['--db=medusa', '--set', 'N=1234', 'q.sql'], () => 'where id between {{N}} - 1 and {{ N }} + 1');
    expect(r.sql).toBe('where id between 1234 - 1 and 1234 + 1');
  });

  it('값에 영숫자·하이픈·밑줄 밖의 문자가 있으면 거절한다(SQL 끼워 넣기 방지)', () => {
    expect(() => parseSqlArgs(['--db', 'core', '--set', "N=1; drop table x", '-e', 'select {{N}}'])).toThrow('영숫자');
    expect(() => parseSqlArgs(['--db', 'core', '--set', "N='a'", '-e', 'select {{N}}'])).toThrow('영숫자');
  });

  it('채울 값이 없는 {{이름}} 은 거절한다', () => {
    expect(() => fillVars('select {{N}}', {})).toThrow('--set N');
  });

  it('--db 가 없거나, 파일과 -e 를 둘 다·하나도 안 주면 거절한다', () => {
    expect(() => parseSqlArgs(['-e', 'select 1'])).toThrow('--db');
    expect(() => parseSqlArgs(['--db', 'core'])).toThrow('정확히 하나');
    expect(() => parseSqlArgs(['--db', 'core', '-e', 'select 1', 'q.sql'], () => 'x')).toThrow('정확히 하나');
  });

  it('런북 SQL 파일의 {{이름}} 은 모두 --set 으로 채울 수 있는 이름이다', () => {
    const dir = path.join(__dirname, 'sql');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql'))) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      const names = [...text.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)].map((m) => m[1]);
      for (const n of names) expect(n).toMatch(/^[A-Za-z0-9_]+$/);
    }
  });
});
