// '@/' 는 admin-web jest 설정에 moduleNameMapper 가 없어 값 import 를 해석하지 못한다
// (타입 전용 import 만 erasure 로 안전하다). 상대경로로 우회한다.
import { BULK_SESSION_PHASES } from '../../../../lib/types/dto/bulk-session';
import { PHASE_LABELS, phaseLabel } from './session-labels';

describe('PHASE_LABELS', () => {
  it('phase 전량에 한국어 라벨이 있다 — 빠지면 배지가 빈 칸이 된다', () => {
    for (const phase of BULK_SESSION_PHASES) {
      expect(PHASE_LABELS[phase]).toBeTruthy();
    }
  });

  it('사람이 읽는 문구다', () => {
    expect(phaseLabel('awaiting_images')).toBe('이미지 대기');
    expect(phaseLabel('review')).toBe('검토 대기');
    expect(phaseLabel('published')).toBe('발행 완료');
  });
});
