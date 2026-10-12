import { BILLING_NOTICE_TEMPLATES } from '../../../../../scripts/seeding/steps/notification.seed-step';
import { KAKAO_AUTO_NOTICES } from './kakao-auto-notices';

describe('알림톡 자동 알림 목록', () => {
  it('시드의 알림톡 자동 알림과 이벤트 키·변수가 같다 — 둘이 갈리면 관리자 연결이 시드와 다른 변수를 허용한다', () => {
    const fromSeed = BILLING_NOTICE_TEMPLATES.map((t) => [t.templateKey, Object.keys(t.variablesSchema).sort()]);
    const fromRegistry = KAKAO_AUTO_NOTICES.map((n) => [n.eventKey, [...n.variables].sort()]);
    expect(fromRegistry).toEqual(fromSeed);
  });
});
