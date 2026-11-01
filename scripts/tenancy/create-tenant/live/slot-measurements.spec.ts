import { slotMeasurementProblems, type SlotObservation } from './slot-measurements';

/**
 * 칸 켠 첫 배포 실측(18 Answer 4·6·7) — 만든 직후 확인이 잰다. 인증서엔 테넌트 이름만, 테넌트 배포가 아몬드영 사이트와
 * 같은 빌드, 테넌트 배포에 무효화가 한 번 이상.
 */
const good: SlotObservation = {
  site: 'AdminWeb',
  host: 'admin.acme.test',
  certSan: 'DNS:admin.acme.test',
  buildId: 'b-123',
  baseBuildId: 'b-123',
  invalidations: 1,
};

describe('칸 실측 판정', () => {
  it('셋 다 맞으면 문제 없음', () => {
    expect(slotMeasurementProblems([good])).toEqual([]);
  });

  it('인증서 SAN 에 다른 이름이 있으면 문제 — 아몬드영 주소가 테넌트 인증서에 보인다', () => {
    expect(slotMeasurementProblems([{ ...good, certSan: 'DNS:admin.acme.test, DNS:admin.other.test' }])).toEqual([
      expect.stringMatching(/admin\.acme\.test.*인증서.*admin\.other\.test/),
    ]);
  });

  it('BUILD_ID 가 다르면 문제 — 무효화가 안 됐거나 원본을 못 따라간다', () => {
    expect(slotMeasurementProblems([{ ...good, buildId: 'b-old' }]).join()).toMatch(/BUILD_ID/);
  });

  it('무효화가 0건이거나 배포를 못 찾았으면 문제', () => {
    expect(slotMeasurementProblems([{ ...good, invalidations: 0 }]).join()).toMatch(/무효화/);
    expect(slotMeasurementProblems([{ ...good, invalidations: null }]).join()).toMatch(/AdminWeb tenant slot/);
  });
});
