import { v7 as uuidv7 } from 'uuid';

/**
 * 모든 도메인 이벤트의 기본 클래스
 * 공통 속성과 메타데이터를 제공합니다.
 */
export abstract class BaseEvent {
  /**
   * 이벤트 고유 ID (ULID)
   */
  public readonly id: string;

  /**
   * 이벤트 발생 시간
   */
  public readonly timestamp: Date;

  /**
   * 이벤트 버전 (스키마 진화를 위한)
   */
  public readonly version: number;

  /**
   * 상관관계 ID (분산 추적을 위한)
   */
  public readonly correlationId?: string;

  /**
   * 이벤트를 발생시킨 주체
   */
  public readonly actor: 'USER' | 'SYSTEM' | 'SCHEDULER' | 'ADMIN';

  constructor(data: {
    correlationId?: string;
    actor: 'USER' | 'SYSTEM' | 'SCHEDULER' | 'ADMIN';
    version?: number;
  }) {
    this.id = uuidv7();
    this.timestamp = new Date();
    this.version = data.version || 1;
    this.correlationId = data.correlationId;
    this.actor = data.actor;
  }

  /**
   * 이벤트를 JSON으로 직렬화
   */
  toJSON(): Record<string, any> {
    return {
      id: this.id,
      timestamp: this.timestamp.toISOString(),
      version: this.version,
      correlationId: this.correlationId,
      actor: this.actor,
      eventType: this.constructor.name,
      data: this.getEventData(),
    };
  }

  /**
   * 각 이벤트 클래스에서 구현해야 하는 데이터 반환 메서드
   */
  protected abstract getEventData(): Record<string, any>;
}

/**
 * 이벤트 핸들러 인터페이스
 */
export interface EventHandler<T extends BaseEvent> {
  handle(event: T): Promise<void>;
}

/**
 * 이벤트 메타데이터 타입
 */
export interface EventMetadata {
  eventId: string;
  eventType: string;
  timestamp: Date;
  correlationId?: string;
  actor: string;
  version: number;
}

/**
 * 이벤트 처리 결과 타입
 */
export interface EventProcessingResult {
  success: boolean;
  eventId: string;
  processingTime: number;
  error?: string;
}
