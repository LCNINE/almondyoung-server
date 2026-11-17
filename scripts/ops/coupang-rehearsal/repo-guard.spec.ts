import { isInsideRepo } from './repo-guard';

describe('isInsideRepo', () => {
  it('레포 자신과 그 아래는 안쪽이다 — `..raw` 같은 이름도 안쪽', () => {
    expect(isInsideRepo('/repo', '/repo')).toBe(true);
    expect(isInsideRepo('/repo', '/repo/out/raw')).toBe(true);
    expect(isInsideRepo('/repo', '/repo/..raw')).toBe(true);
  });

  it('형제 디렉터리(접두어만 같은 이름)와 부모는 바깥이다', () => {
    expect(isInsideRepo('/repo', '/repo-other')).toBe(false);
    expect(isInsideRepo('/repo', '/')).toBe(false);
    expect(isInsideRepo('/repo/sub', '/repo')).toBe(false);
    expect(isInsideRepo('/repo', '/tmp/out')).toBe(false);
  });
});
