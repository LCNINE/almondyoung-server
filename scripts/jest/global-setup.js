/**
 * jest 전역 setup — 프로세스 타임존을 UTC 로 박는다 (#724 항목 13).
 *
 * 왜: 라이브(ECS/Lambda)와 CI 러너는 UTC 인데 개발 머신은 `Asia/Seoul` 이다.
 * `date-fns-tz` 의 `toZonedTime` 은 런타임 TZ 에 상대적이라, 서울 머신에서는 서울 오프셋을
 * 두 번 거는 코드가 **항등이 되어 버그가 통째로 사라진다.** 실제로 그렇게 놓친 라이브 버그가
 * 있다 — 당일 입고 취소가 KST 15:00~24:00 에 전부 400 이었는데 로컬 스펙은 초록이었다
 * (#724 발견 ⑪). TZ 를 로컬에서도 UTC 로 맞춰야 이 부류가 작성자 손에서 보인다.
 *
 * 왜 여기인가: **스펙 파일 안에서 `process.env.TZ` 를 바꾸는 것은 이미 늦다.** 이 파일은
 * 워커가 fork 되기 전에 돌아서, 워커 모드에서는 env 상속으로 · `--runInBand` 에서는 Node 의
 * TZ 캐시 갱신으로 양쪽 다 먹는다 (세 실행 모드에서 실측).
 *
 * 하드 핀이 아닌 이유: TZ 견고성을 일부러 확인할 때가 있다
 * (`TZ=America/New_York npx jest --testPathPattern=time.util`). 셸에 `TZ` 가 있으면 그걸 존중하고,
 * 없을 때만 UTC 로 떨어진다. 개발 머신 셸에는 보통 `TZ` 가 없다 — 그래서 기본값이 UTC 다.
 */
module.exports = async () => {
  process.env.TZ = process.env.TZ || 'UTC';
};
