import { Logger } from '@nestjs/common';
import type { StreamTopicConfig } from '@packages/event-contracts/types';
import { DEFAULT_TOPIC_PARTITIONS } from '../bootstrap/topic-bootstrap.service';
import { dropConsumerLagSeries, initConsumerLagSeries, setConsumerLag } from './consumer-lag.metrics';

/** kafkajs `Admin` 중 이 폴러가 쓰는 표면. 스펙이 가짜를 끼우는 자리다. */
export interface ConsumerLagAdmin {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  fetchOffsets(options: {
    groupId: string;
    topics: string[];
  }): Promise<Array<{ topic: string; partitions: Array<{ partition: number; offset: string }> }>>;
  fetchTopicOffsets(topic: string): Promise<Array<{ partition: number; high: string }>>;
}

export type ConsumerLagTopic = Pick<StreamTopicConfig, 'topic' | 'partitions'>;

/**
 * 폴링 주기 (#815). 브로커는 t4g.micro 단일 노드 Redpanda 라 요청당 과금이 아니라 CPU 가 제약이다.
 * tick 당 앱 하나가 `1 + 구독 토픽 수` 요청을 보내므로 8개 앱 전체가 32 요청/30초 ≈ 1.1 req/s —
 * 컨슈머 heartbeat(8 × 1/3s ≈ 2.7 req/s) 의 절반 이하다. 배포 중 태스크가 겹쳐 2배가 돼도
 * heartbeat 를 넘지 않는다. 60초가 아닌 이유는 스크레이프 최소 주기(core 30s)와 맞춰 값이
 * 두 스크레이프에 걸쳐 낡는 것을 피하기 위해서다.
 */
export const CONSUMER_LAG_POLL_INTERVAL_MS = 30_000;

/**
 * 컨슈머 그룹의 파티션별 lag 을 주기적으로 브로커에 물어 게이지에 쓴다 (#815).
 *
 * **왜 cron 이 쓰고 scrape 는 읽기만 하나:** scrape 시점에 브로커를 부르면 브로커가 느릴 때
 * 스크레이프가 타임아웃돼 `up=0` 이 된다 = 관측 실패가 가용성 알람으로 승격. 값은 미리 메모리에 쓴다.
 *
 * **왜 `@Cron` 이 아니라 `setInterval` 인가:** `@Cron` 은 DI provider 여야 하는데 core 는
 * `forApp` 을 BC 별로 6번 부른다 — provider 로 두면 인스턴스 6개·크론 6개다. 게다가 소비 집합은
 * `startConsumer` 시점에야 도출되므로(ADR-0029 §3) 폴러도 그때 만들어야 한다. 그래서 `@Cron`
 * 감사(#707 의 grep) 에는 안 잡힌다 — 겹쳐 돌아도 무해하다(게이지는 같은 값을 두 번 쓴다).
 *
 * 실패는 로그만 남긴다. `topic-bootstrap` 과 같은 관례다 — 관측이 앱을 죽이면 안 된다.
 */
export class ConsumerLagCollector {
  private readonly logger = new Logger(ConsumerLagCollector.name);
  private readonly topics: string[];
  private timer?: NodeJS.Timeout;
  private connected = false;
  private inFlight = false;

  constructor(
    private readonly admin: ConsumerLagAdmin,
    private readonly groupId: string,
    private readonly declared: ConsumerLagTopic[],
    private readonly intervalMs: number = CONSUMER_LAG_POLL_INTERVAL_MS,
  ) {
    this.topics = declared.map((t) => t.topic);
  }

  /**
   * 선언 파티션 수로 0 시리즈를 세우고 즉시 한 번 돈 뒤 주기를 건다.
   *
   * 씨는 **선언**에서 뿌린다 — 실제 수는 첫 tick 이 알려 주지만 브로커에 못 닿아도 시리즈는
   * 있어야 한다. 선언과 실제가 다르면 첫 tick 이 맞춘다(`reconcilePartitions`).
   *
   * @returns 첫 tick 의 promise — 부팅 경로는 기다리지 않는다(`void`). 스펙만 기다린다.
   */
  start(): Promise<void> {
    for (const { topic, partitions } of this.declared) {
      initConsumerLagSeries(this.groupId, topic, partitions ?? DEFAULT_TOPIC_PARTITIONS);
    }
    // unref: 이 타이머가 프로세스 종료를 붙들면 안 된다.
    this.timer = setInterval(() => void this.refresh(), this.intervalMs);
    this.timer.unref();
    return this.refresh();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (!this.connected) return;
    this.connected = false;
    await this.admin.disconnect().catch(() => undefined);
  }

  /** tick 하나. 앞 tick 이 아직 돌고 있으면 건너뛴다 — 느린 브로커에 요청이 쌓이면 안 된다. */
  async refresh(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      await this.ensureConnected();
      await this.collect();
    } catch (error) {
      this.logger.error(
        `Consumer lag refresh failed (group=${this.groupId}): ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.inFlight = false;
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    await this.admin.connect();
    this.connected = true;
  }

  /**
   * 그룹 오프셋은 **한 요청**(OffsetFetch) 으로 전 토픽을 묻고, high watermark 는 토픽마다 묻는다
   * (kafkajs 에 다중 토픽 ListOffsets 표면이 없다). 그래서 tick 당 요청 수는 `1 + 토픽 수` 다.
   */
  private async collect(): Promise<void> {
    const committedByTopic = new Map<string, Map<number, number>>();
    for (const { topic, partitions } of await this.admin.fetchOffsets({ groupId: this.groupId, topics: this.topics })) {
      committedByTopic.set(topic, new Map(partitions.map((p) => [p.partition, Number(p.offset)])));
    }

    for (const { topic, partitions: declaredPartitions } of this.declared) {
      const highs = await this.admin.fetchTopicOffsets(topic);
      const committed = committedByTopic.get(topic) ?? new Map<number, number>();

      for (const { partition, high } of highs) {
        const offset = committed.get(partition) ?? -1;
        // 커밋 오프셋이 없으면(-1) lag 도 -1 — 파사드 주석 참조.
        setConsumerLag(this.groupId, topic, partition, offset < 0 ? -1 : Number(high) - offset);
      }

      this.reconcilePartitions(topic, declaredPartitions ?? DEFAULT_TOPIC_PARTITIONS, highs.length);
    }
  }

  /** 선언보다 실제 파티션이 적으면 씨 뿌린 초과 시리즈를 지운다 — 남기면 거짓 0 이 영원히 선다. */
  private reconcilePartitions(topic: string, declared: number, actual: number): void {
    for (let partition = actual; partition < declared; partition += 1) {
      dropConsumerLagSeries(this.groupId, topic, partition);
    }
  }
}

/**
 * 살아 있는 폴러 목록. 폴러는 DI 밖에 산다(위 주석) — 종료 훅이 닿을 자리가 없으므로
 * `GracefulShutdownService.onApplicationShutdown` 이 이 목록을 통해 멈춘다.
 */
const activeCollectors = new Set<ConsumerLagCollector>();

export function registerConsumerLagCollector(collector: ConsumerLagCollector): void {
  activeCollectors.add(collector);
}

/** 등록된 폴러를 전부 멈추고 admin 연결을 끊는다. 두 번 불려도 무해하다. */
export async function stopConsumerLagCollectors(): Promise<void> {
  const collectors = [...activeCollectors];
  activeCollectors.clear();
  await Promise.all(collectors.map((collector) => collector.stop()));
}
