import { CategoryEnsureMemoService } from './category-ensure-memo.service';

const config = (maxEntries?: number) => ({ get: () => maxEntries }) as never;

describe('CategoryEnsureMemoService', () => {
  let memo: CategoryEnsureMemoService;
  let ensure: jest.Mock<Promise<void>, []>;

  beforeEach(() => {
    memo = new CategoryEnsureMemoService(config());
    ensure = jest.fn().mockResolvedValue(undefined);
  });

  it('같은 카테고리를 같은 내용으로 다시 보장하면 건너뛴다', async () => {
    await memo.ensureOnce('c1', { name: 'A' }, ensure);
    await memo.ensureOnce('c1', { name: 'A' }, ensure);

    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it('내용이 바뀌면 다시 보장한다', async () => {
    await memo.ensureOnce('c1', { name: 'A' }, ensure);
    await memo.ensureOnce('c1', { name: 'B' }, ensure);

    expect(ensure).toHaveBeenCalledTimes(2);
  });

  it('보장이 실패하면 기억하지 않는다 — 실패한 상태로 굳으면 다음 이벤트까지 안 고쳐진다', async () => {
    ensure.mockRejectedValueOnce(new Error('medusa down'));

    await expect(memo.ensureOnce('c1', { name: 'A' }, ensure)).rejects.toThrow('medusa down');
    await memo.ensureOnce('c1', { name: 'A' }, ensure);

    expect(ensure).toHaveBeenCalledTimes(2);
  });

  it('키 순서만 다른 같은 내용은 같은 것으로 본다 — 스냅샷 조립 순서에 판정이 흔들리면 안 된다', async () => {
    await memo.ensureOnce('c1', { name: 'A', sortOrder: 1 }, ensure);
    await memo.ensureOnce('c1', { sortOrder: 1, name: 'A' }, ensure);

    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it('중첩된 객체의 키 순서도 무시한다', async () => {
    await memo.ensureOnce('c1', { meta: { a: 1, b: 2 } }, ensure);
    await memo.ensureOnce('c1', { meta: { b: 2, a: 1 } }, ensure);

    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it('invalidate 한 카테고리는 다시 보장한다 — 삭제처럼 메모 밖에서 바뀐 경우가 있다', async () => {
    await memo.ensureOnce('c1', { name: 'A' }, ensure);
    memo.invalidate('c1');
    await memo.ensureOnce('c1', { name: 'A' }, ensure);

    expect(ensure).toHaveBeenCalledTimes(2);
  });

  it('상한을 넘기면 오래된 항목부터 버린다', async () => {
    const capped = new CategoryEnsureMemoService(config(2));

    await capped.ensureOnce('c1', { name: 'A' }, ensure);
    await capped.ensureOnce('c2', { name: 'B' }, ensure);
    await capped.ensureOnce('c3', { name: 'C' }, ensure);
    await capped.ensureOnce('c1', { name: 'A' }, ensure);

    expect(ensure).toHaveBeenCalledTimes(4);
  });

  it('상한이 0 이면 메모를 끈다 — 킬스위치', async () => {
    const disabled = new CategoryEnsureMemoService(config(0));

    await disabled.ensureOnce('c1', { name: 'A' }, ensure);
    await disabled.ensureOnce('c1', { name: 'A' }, ensure);

    expect(ensure).toHaveBeenCalledTimes(2);
  });
});
