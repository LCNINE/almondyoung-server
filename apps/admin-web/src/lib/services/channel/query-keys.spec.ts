import { channelQueryKeys } from './query-keys';

describe('channelQueryKeys — 채널과 어긋남', () => {
  const keys = [
    channelQueryKeys.mismatchSummary,
    channelQueryKeys.mismatchList('open'),
    channelQueryKeys.mismatchList('all'),
  ];

  it('목록·요약 키는 무효화 접두사로 시작한다 — 접두사 하나로 둘 다 갱신된다', () => {
    const prefix = channelQueryKeys.mismatches;
    for (const key of keys)
      expect(key.slice(0, prefix.length)).toEqual([...prefix]);
  });

  it('키에 undefined 가 없다 — 있으면 위치별 비교라 무효화가 조용히 빗나간다', () => {
    for (const key of keys) expect(key).not.toContain(undefined);
  });

  it('격리 키와 접두사가 다르다 — 격리 무효화가 어긋남 목록을 흔들지 않는다', () => {
    expect(channelQueryKeys.mismatches[0]).not.toBe(
      channelQueryKeys.failures[0]
    );
  });
});
