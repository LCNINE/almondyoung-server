import { STREAM_REGISTRY } from './registry';

/**
 * 계약의 모든 이벤트는 테넌트 이벤트다 — 소비 앱의 문이 봉투의 테넌트로 거른다.
 *
 * 계정 변경·탈퇴·휴면 전환·영구 삭제는 한때 «계정 이벤트»로 선언돼 문을 테넌트와 상관없이 통과했다(계정이 테넌트로
 * 쪼개지지 않던 때, ADR 0052). 계정이 한 테넌트의 것이 되면서(ADR-0056) 그 네 이벤트의 테넌트는 계정의 테넌트이고,
 * 테넌트 1 만 섬기는 앱은 다른 테넌트 계정의 탈퇴를 건너뛴다. 테넌트와 상관없이 통과하는 선언은 다시 만들지 않는다 —
 * 그 하나가 테넌트 1 서비스에 남의 테넌트 계정을 지우게 한다.
 */
describe('이벤트의 테넌트 성격', () => {
  it('어떤 이벤트 정의도 테넌트 성격을 따로 선언하지 않는다(전부 테넌트 이벤트)', () => {
    const declared = Object.values(STREAM_REGISTRY).flatMap((stream) =>
      Object.entries(stream.events)
        .filter(([, definition]) => Object.keys(definition).some((key) => key !== 'messageType' && key !== 'schema'))
        .map(([messageType]) => `${stream.topic.topic}:${messageType}`),
    );
    expect(declared).toEqual([]);
  });

  it('계정 수명주기 넷은 계약에 그대로 있다 — 이벤트를 지운 것이 아니라 성격을 바꾼 것이다', () => {
    expect(Object.keys(STREAM_REGISTRY['users.events.v1'].events)).toEqual(
      expect.arrayContaining(['UserUpdated', 'UserDeleted', 'UserDormantConverted', 'UserPermanentDeleted']),
    );
  });
});
