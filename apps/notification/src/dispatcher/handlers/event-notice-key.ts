/**
 * 이벤트 하나가 만든 알림의 멱등 키 (#1073).
 *
 * messageId 는 envelope 마다 유일하므로 Kafka 재전달이면 같은 키가 된다. eventKey·userId 를 붙이는
 * 이유: 한 이벤트가 서로 다른 알림이나 여러 수신자에게 보낼 때 두 번째가 «중복»으로 버려지면 안 된다.
 * 채널은 디스패처의 ON CONFLICT 대상에 이미 있다.
 *
 * messageId 가 비면 키를 만들지 않는다(undefined). 빈 값으로 만든 키 하나가 그 유형의 이후 알림을
 * 전부 «중복»으로 삼키기 때문이다 — 키가 없으면 디스패처는 예전처럼 새 행을 넣는다.
 */
export const eventNoticeKey = (messageId: string, eventKey: string, userId: string): string | undefined =>
  messageId ? `event:${messageId}:${eventKey}:${userId}` : undefined;
