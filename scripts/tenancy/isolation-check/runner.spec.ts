import { fail, pass, skip } from './judge';
import { IsolationCheck, runChecks } from './runner';

function check(over: Partial<IsolationCheck<void>> & Pick<IsolationCheck<void>, 'run'>): IsolationCheck<void> {
  return { section: '직접 호출', title: '무언가', part: 'read', fixedBy: '티켓 10', ...over };
}

async function runQuiet(checks: IsolationCheck<void>[], opts: { write?: boolean; strict?: boolean } = {}) {
  const lines: string[] = [];
  const result = await runChecks(checks, undefined, {
    write: false,
    strict: false,
    ...opts,
    print: (l) => lines.push(l),
  });
  return { ...result, out: lines.join('\n') };
}

describe('runChecks', () => {
  it('전부 통과면 실패 0', async () => {
    const r = await runQuiet([check({ run: () => Promise.resolve(pass) })]);
    expect(r.failed).toBe(0);
  });

  it('✗ 마다 무엇이 깨졌고 무엇이 고치는지 적는다', async () => {
    const r = await runQuiet([
      check({
        title: 'Medusa 상품 403',
        fixedBy: '티켓 10 — admitServerCredentialTenant',
        run: () => Promise.resolve(fail('200 — 남의 테넌트 응답이 나왔다')),
      }),
    ]);
    expect(r.failed).toBe(1);
    expect(r.out).toContain('Medusa 상품 403');
    expect(r.out).toContain('200 — 남의 테넌트 응답이 나왔다');
    expect(r.out).toContain('티켓 10 — admitServerCredentialTenant');
  });

  it('던진 점검은 ✗ 로 적고 다음 점검을 계속 돈다', async () => {
    const second = jest.fn(() => Promise.resolve(pass));
    const r = await runQuiet([
      check({
        run: () => Promise.reject(new Error('ECONNREFUSED')),
      }),
      check({ run: second }),
    ]);
    expect(r.failed).toBe(1);
    expect(r.out).toContain('ECONNREFUSED');
    expect(second).toHaveBeenCalled();
  });

  it('쓰기 점검은 write 일 때만 돈다 — 읽기 전용 실행은 아무것도 만들지 않는다', async () => {
    const write = jest.fn(() => Promise.resolve(pass));
    await runQuiet([check({ part: 'write', run: write })]);
    expect(write).not.toHaveBeenCalled();
    await runQuiet([check({ part: 'write', run: write })], { write: true });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('건너뜀은 경고지만 strict(라이브)면 실패다 — 라이브에서 «못 쟀다»는 통과가 아니다', async () => {
    const skipped = [check({ run: () => Promise.resolve(skip('search 가 로컬에 안 떠 있다')) })];
    const local = await runQuiet(skipped);
    expect(local.failed).toBe(0);
    expect(local.skipped).toBe(1);
    expect(local.out).toContain('search 가 로컬에 안 떠 있다');
    const live = await runQuiet(skipped, { strict: true });
    expect(live.failed).toBe(1);
  });
});
