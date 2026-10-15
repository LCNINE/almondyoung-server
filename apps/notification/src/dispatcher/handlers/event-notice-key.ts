/**
 * 이벤트 하나가 만든 알림의 멱등 키 (#1073).
 *
 * messageId 는 envelope 마다 유일하므로 Kafka 재전달이면 같은 키가 된다. eventKey·userId 를 붙이는
 * 이유: 한 이벤트가 서로 다른 알림이나 여러 수신자에게 보낼 때 두 번째가 «중복»으로 버려지면 안 된다.
 * 채널은 디스패처의 ON CONFLICT 대상에 이미 있다.
 */
export const eventNoticeKey = (messageId: string, eventKey: string, userId: string): string =>
  `event:${messageId}:${eventKey}:${userId}`;
