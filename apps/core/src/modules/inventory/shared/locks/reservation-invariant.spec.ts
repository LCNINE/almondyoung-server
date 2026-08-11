import { violatesReservationInvariant } from './reservation-invariant';

// 이 술어는 이제 availability 모듈의 violatesAvailability 를 그대로 노출한다.
// 아래 케이스는 위임 전 동작을 그대로 기술한 것 — 위임이 동작을 바꾸지 않음을 고정한다.
describe('violatesReservationInvariant', () => {
  it('차감 후 ON_HAND 가 예약보다 적으면 위반', () => {
    expect(violatesReservationInvariant(10, 6, 5)).toBe(true); // 10-5=5 < 6
  });
  it('차감 후 ON_HAND 가 예약과 같으면 통과', () => {
    expect(violatesReservationInvariant(10, 6, 4)).toBe(false); // 10-4=6 >= 6
  });
  it('예약 0 이면 항상 통과', () => {
    expect(violatesReservationInvariant(10, 0, 10)).toBe(false);
  });
  it('차감 0 이어도 이미 초과 상태면 위반으로 본다', () => {
    expect(violatesReservationInvariant(3, 5, 0)).toBe(true);
  });
});
