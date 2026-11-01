import {
  CreationStep,
  runCreation,
  StepPaused,
  StepRefused,
  TenantCreationFailed,
  TenantCreationPaused,
} from './runner';

/** 상태를 들고 있는 가짜 단계. `done` 이 곧 «이미 됐나»의 답이고, run 은 done 을 켠다. */
function fakeStep(name: string, opts: { done?: boolean; fails?: boolean; commitPoint?: boolean } = {}) {
  const calls: string[] = [];
  const step: CreationStep & { done: boolean; calls: string[] } = {
    name,
    done: opts.done ?? false,
    calls,
    commitPoint: opts.commitPoint,
    async isDone() {
      return step.done;
    },
    async run() {
      calls.push('run');
      if (opts.fails) throw new Error(`${name} 터짐`);
      step.done = true;
    },
    async undo() {
      calls.push('undo');
      step.done = false;
    },
  };
  return step;
}

const quiet = () => undefined;

describe('테넌트 만들기 단계 러너', () => {
  it('이미 된 단계는 건너뛰고 안 된 단계만 차례로 돌린다', async () => {
    const a = fakeStep('행', { done: true });
    const b = fakeStep('DB');
    const c = fakeStep('목록', { commitPoint: true });

    const report = await runCreation([a, b, c], quiet);

    expect(report).toEqual([
      { name: '행', outcome: 'skipped' },
      { name: 'DB', outcome: 'ran' },
      { name: '목록', outcome: 'ran' },
    ]);
    expect(a.calls).toEqual([]);
  });

  it('두 번째 실행은 아무것도 돌리지 않는다', async () => {
    const steps = [fakeStep('행'), fakeStep('DB'), fakeStep('목록', { commitPoint: true })];
    await runCreation(steps, quiet);

    const again = await runCreation(steps, quiet);

    expect(again.map((r) => r.outcome)).toEqual(['skipped', 'skipped', 'skipped']);
  });

  it('목록에 넣기 전에 실패하면 지나온 단계를 거꾸로 되돌린다 — 지난 실행에서 된 단계까지', async () => {
    const row = fakeStep('행', { done: true }); // 지난 실행이 만들었다
    const db = fakeStep('DB');
    const role = fakeStep('역할', { fails: true });
    const list = fakeStep('목록', { commitPoint: true });
    const order: string[] = [];
    for (const s of [row, db, role, list]) {
      const undo = s.undo!.bind(s);
      s.undo = async () => {
        order.push(s.name);
        await undo();
      };
    }

    const failure = await runCreation([row, db, role, list], quiet).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(TenantCreationFailed);
    expect(failure).toMatchObject({ failedStep: '역할', rolledBack: true, undoErrors: [] });
    expect(order).toEqual(['목록', '역할', 'DB', '행']);
    expect([row.done, db.done]).toEqual([false, false]);
  });

  it('목록에 넣은 뒤의 실패는 되돌리지 않는다 — 다시 돌리면 실패한 단계부터 이어간다', async () => {
    let activateFails = true;
    const row = fakeStep('행');
    const list = fakeStep('목록', { commitPoint: true });
    const activate = fakeStep('활성');
    const run = activate.run.bind(activate);
    activate.run = async () => {
      if (activateFails) throw new Error('확인 실패');
      await run();
    };

    const failure = await runCreation([row, list, activate], quiet).catch((e: unknown) => e);
    expect(failure).toMatchObject({ failedStep: '활성', rolledBack: false });
    expect(row.calls).toEqual(['run']);

    activateFails = false;
    const resumed = await runCreation([row, list, activate], quiet);
    expect(resumed.map((r) => r.outcome)).toEqual(['skipped', 'skipped', 'ran']);
  });

  it('되돌리기 하나가 실패해도 나머지는 되돌리고, 실패를 함께 알린다', async () => {
    const row = fakeStep('행');
    const db = fakeStep('DB');
    db.undo = async () => {
      throw new Error('DROP 실패');
    };
    const broken = fakeStep('버킷', { fails: true });

    const failure = await runCreation([row, db, broken, fakeStep('목록', { commitPoint: true })], quiet).catch(
      (e: unknown) => e,
    );

    expect(failure).toMatchObject({ rolledBack: true, undoErrors: ['DB: DROP 실패'] });
    expect(row.done).toBe(false);
  });

  it('남의 상태를 보고 거절한 단계는 되돌리지 않는다 — 그 DB·행은 이 실행의 것이 아닐 수 있다', async () => {
    const db = fakeStep('DB', { done: true });
    const role = fakeStep('역할', { done: true });
    const foreign = fakeStep('점검 계정');
    foreign.isDone = async () => {
      throw new StepRefused('테넌트 2 가 다른 slug 로 이미 있다');
    };
    const list = fakeStep('목록', { commitPoint: true }); // 아직 안 넣었다 — 보통이면 되돌릴 자리

    const failure = await runCreation([db, role, foreign, list], quiet).catch((e: unknown) => e);

    expect(failure).toMatchObject({ failedStep: '점검 계정', rolledBack: false });
    expect([db.calls, role.calls, list.calls]).toEqual([[], [], []]);
    expect(db.done).toBe(true);
  });

  it('돌렸는데도 «됐다»가 안 되면 실패다 — 고장 난 «이미 됐나»가 다음 실행을 헛돌게 두지 않는다', async () => {
    const liar = fakeStep('역할');
    liar.run = async () => undefined;

    const failure = await runCreation([liar, fakeStep('목록', { commitPoint: true })], quiet).catch((e: unknown) => e);

    expect(failure).toMatchObject({ failedStep: '역할', rolledBack: true });
  });

  it('사람 손 단계에서 멈추면 목록 전이라도 되돌리지 않는다 — 다시 돌리면 그 단계부터 이어간다', async () => {
    const db = fakeStep('DB');
    const secrets = fakeStep('칸 Secret');
    let humanDone = false;
    secrets.isDone = async () => humanDone;
    secrets.run = async () => {
      throw new StepPaused(['npx sst secret load … --stage live']);
    };
    const list = fakeStep('목록', { commitPoint: true });

    const paused = await runCreation([db, secrets, list], quiet).catch((e: unknown) => e);

    expect(paused).toBeInstanceOf(TenantCreationPaused);
    expect(paused).toMatchObject({ pausedStep: '칸 Secret', todo: ['npx sst secret load … --stage live'] });
    expect(db.calls).toEqual(['run']);
    expect(db.done).toBe(true);

    humanDone = true;
    const resumed = await runCreation([db, secrets, list], quiet);
    expect(resumed.map((r) => r.outcome)).toEqual(['skipped', 'skipped', 'ran']);
  });
});
