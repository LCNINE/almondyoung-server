/**
 * core 의 Kafka 컨슈머 그룹(`startConsumer` 의 `groupId`). 실패 테이블 행의 `consumer_group` 칸이고, 공용 `.dlq` 토픽에서
 * core 의 실패를 고르는 열쇠다 — `scripts/events/untenanted-dlq-import.ts` 가 이 값을 쓴다.
 */
export const CORE_CONSUMER_GROUP = 'almondyoung-order-consumer';
