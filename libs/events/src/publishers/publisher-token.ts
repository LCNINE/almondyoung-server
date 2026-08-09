/**
 * Publisher DI 토큰
 *
 * `EventsModule.forRoot({streams})` 가 스트림당 하나씩 등록하는 `StreamPublisher`
 * provider 의 토큰 형식. `EventsModule.getPublisherToken` 과 `@InjectPublisher` 가
 * 같은 문자열을 만들어야 하므로 형식은 여기 한 곳에만 둔다 — 두 벌이 되는 순간
 * 어긋남이 무증상 DI 실패로 나타난다.
 */
export function getPublisherToken(topicName: string): string {
  return `STREAM_PUBLISHER_${topicName}`;
}
