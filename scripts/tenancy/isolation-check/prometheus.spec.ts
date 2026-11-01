import { sumSamples } from './prometheus';

const TEXT = `# HELP events_skipped_other_tenant_total Tenant events skipped
# TYPE events_skipped_other_tenant_total counter
events_skipped_other_tenant_total{topic="products.events.v1"} 3
events_skipped_other_tenant_total{topic="inventory.events.v1"} 1
events_skipped_other_tenant_total_created{topic="products.events.v1"} 1700000000
events_dlq_messages_total{topic="a",consumer="b",error="x"} 2
events_dlq_messages_total_created{topic="a",consumer="b",error="x"} 1700000000
events_outbox_published_total{topic="a"} 5 1700000000000
`;

describe('sumSamples', () => {
  it('라벨이 달라도 같은 이름의 샘플을 다 더한다', () => {
    expect(sumSamples(TEXT, 'events_skipped_other_tenant_total')).toBe(4);
  });

  it('이름이 접두사로만 같은 다른 계열(_created)은 더하지 않는다', () => {
    expect(sumSamples(TEXT, 'events_dlq_messages_total')).toBe(2);
  });

  it('값 뒤의 타임스탬프를 값으로 읽지 않는다', () => {
    expect(sumSamples(TEXT, 'events_outbox_published_total')).toBe(5);
  });

  it('한 번도 오르지 않은 카운터(샘플 없음)는 0 이다', () => {
    expect(sumSamples(TEXT, 'events_dlq_send_failures_total')).toBe(0);
  });
});
