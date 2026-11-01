import { parseTenantList } from '@app/tenancy';
import { deadLetterFromDlq } from './dlq-import';

const tenants = parseTenantList(
  JSON.stringify([
    { id: 'a', slug: 'alpha', coreDb: 'core_a', publicBucket: 'bucket-a', privateBucket: 'bucket-a' },
    { id: 'b', slug: 'beta', coreDb: 'core_b', publicBucket: 'bucket-b-pub', privateBucket: 'bucket-b-priv' },
  ]),
);

const envelope = (metadata?: Record<string, unknown>) => ({
  messageId: 'm-1',
  messageType: 'CartCreated',
  messageVersion: 1,
  source: { service: 'medusa', aggregateType: 'Cart', aggregateId: 'cart-1' },
  payload: { id: 'cart-1' },
  ...(metadata ? { metadata } : {}),
});

/** `DLQHandler.sendToDLQ` 가 `.dlq` 에 쓰는 모양 */
const dlqMessage = (overrides: Record<string, unknown> = {}, original: unknown = envelope()) => ({
  dlqMessageId: 'dlq-1',
  dlqTopic: 'carts.events.v1.dlq',
  originalTopic: 'carts.events.v1',
  originalPartition: 2,
  originalOffset: '41',
  originalMessage: original,
  error: { name: 'TenantGateRejection', message: '봉투 테넌트가 없다' },
  context: { consumer: 'onCreated', handler: 'CartConsumer.onCreated', consumerGroup: 'core-group', retryCount: 1 },
  failedAt: '2026-11-02T00:00:00.000Z',
  status: 'pending',
  ...overrides,
});

const target = { consumerGroup: 'core-group', tenantId: 'b', tenants };

describe('deadLetterFromDlq — .dlq 메시지에 테넌트를 붙여 실패 행으로 (ticket 30)', () => {
  it('봉투에 테넌트를 붙인 failed 행 — 순서 키 없이(혼자 한 순서), 원래 위치·오류를 싣는다', () => {
    expect(deadLetterFromDlq(dlqMessage(), target)).toEqual({
      kind: 'import',
      row: {
        consumerGroup: 'core-group',
        handler: 'CartConsumer.onCreated',
        topic: 'carts.events.v1',
        sequenceKey: null,
        messageId: 'm-1',
        eventType: 'CartCreated',
        envelope: { ...envelope(), metadata: { tenantId: 'b' } },
        kafkaPartition: 2,
        kafkaOffset: '41',
        status: 'failed',
        errorName: 'TenantGateRejection',
        errorMessage: '봉투 테넌트가 없다',
      },
    });
  });

  it('목록 밖 테넌트는 지목한 테넌트로 바꾸고 봉투의 다른 metadata 는 둔다', () => {
    const verdict = deadLetterFromDlq(dlqMessage({}, envelope({ tenantId: 'zzz', chainId: 'ch-1' })), target);
    expect(verdict.kind === 'import' && verdict.row.envelope).toEqual({
      ...envelope(),
      metadata: { tenantId: 'b', chainId: 'ch-1' },
    });
  });

  it.each([
    ['다른 컨슈머 그룹(같은 토픽의 다른 구독자)', dlqMessage({ context: { consumer: 'x', consumerGroup: 'other' } })],
    ['그룹이 없는 옛 메시지', dlqMessage({ context: { consumer: 'x', handler: 'CartConsumer.onCreated' } })],
    ['봉투를 못 알아본다', dlqMessage({}, { raw: 'not json' })],
    ['목록에 있는 다른 테넌트의 봉투', dlqMessage({}, envelope({ tenantId: 'a' }))],
    ['DLQ 메시지 모양이 아니다', { hello: 1 }],
    [
      '계정 이벤트(테넌트 맥락 없이 처리돼야 한다)',
      dlqMessage({ originalTopic: 'users.events.v1' }, { ...envelope(), messageType: 'UserDeleted' }),
    ],
  ])('%s 은 가져오지 않는다', (_name, message) => {
    expect(deadLetterFromDlq(message, target).kind).toBe('skip');
  });

  it('목록에 없는 테넌트로는 붙이지 않는다', () => {
    expect(() => deadLetterFromDlq(dlqMessage(), { ...target, tenantId: 'zzz' })).toThrow(/목록/);
  });
});
