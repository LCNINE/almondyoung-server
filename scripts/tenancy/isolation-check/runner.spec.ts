import { fail, pass, skip, skipNoRows } from './judge';
import { exitCodeOf, IsolationCheck, NO_ROWS_ONLY_EXIT, runChecks } from './runner';

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

  describe('«행이 없어 못 잼»만 남은 읽기 전용 실행', () => {
    // 새 테넌트는 상품이 0 이라 상세 화면을 읽기 전용으로는 영영 못 연다. 그 실패만 남았으면
    // 쓰기 실측(--write)이 행을 만들어 재면 된다는 걸 종료코드로 알린다(테넌트 만들기의 직원 단계가 받는다).
    const noRows = check({ title: '화면', run: () => Promise.resolve(skipNoRows('상품 0 — 상세 화면을 못 연다')) });
    const leak = check({ title: '목록', run: () => Promise.resolve(fail('테넌트 1 행이 보인다')) });
    const other = check({ title: '메트릭', run: () => Promise.resolve(skip('수집 기록이 없다')) });

    it('그것만 남았으면 NO_ROWS_ONLY_EXIT', async () => {
      const r = await runQuiet([noRows, check({ run: () => Promise.resolve(pass) })], { strict: true });
      expect(r.failed).toBe(1);
      expect(exitCodeOf(r, { write: false })).toBe(NO_ROWS_ONLY_EXIT);
    });

    it('다른 실패가 하나라도 섞이면 1 — 쓰기 실측으로 넘기지 않는다', async () => {
      expect(exitCodeOf(await runQuiet([noRows, leak], { strict: true }), { write: false })).toBe(1);
      expect(exitCodeOf(await runQuiet([noRows, other], { strict: true }), { write: false })).toBe(1);
    });

    it('쓰기 실행에서 남았으면 1 — 행을 만들고도 못 연 것이다', async () => {
      expect(exitCodeOf(await runQuiet([noRows], { strict: true, write: true }), { write: true })).toBe(1);
    });

    it('실패 0 이면 0', async () => {
      expect(exitCodeOf(await runQuiet([noRows]), { write: false })).toBe(0);
    });
  });
});
