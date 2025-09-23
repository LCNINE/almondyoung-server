import { Injectable, Logger } from '@nestjs/common';
import { ChannelType } from './strategies/channel-strategy.factory';
import { DataType } from '../types';

/**
 * 채널별 동기화 상태 및 통계 관리 서비스
 *
 * 각 판매채널의 동기화 이력, 성공/실패 통계, 성능 지표를 관리합니다.
 * PoC 단계에서는 메모리 기반으로 동작하며, 운영 단계에서는 Redis/DB로 확장 가능합니다.
 *
 * @example
 * ```typescript
 * // 동기화 시작 시점 기록
 * await syncStatusService.recordSyncStart('naver_smartstore', 'orders');
 *
 * // 동기화 완료 기록
 * await syncStatusService.recordSyncComplete('naver_smartstore', 'orders', {
 *   eventCount: 25,
 *   processingTime: 1450
 * });
 *
 * // 채널별 통계 조회
 * const stats = await syncStatusService.getChannelStats('naver_smartstore');
 * ```
 */
@Injectable()
export class SyncStatusService {
  private readonly logger = new Logger(SyncStatusService.name);

  // PoC: 메모리 기반 상태 저장소 (운영에서는 Redis/DB로 교체)
  private readonly syncHistory = new Map<string, SyncRecord[]>();
  private readonly channelStats = new Map<string, ChannelStats>();

  constructor() {
    // 초기 채널 통계 설정
    this.initializeChannelStats();
  }

  /**
   * 동기화 시작 기록
   *
   * @param channel 채널 타입
   * @param dataType 데이터 타입
   * @returns 동기화 세션 ID
   */
  async recordSyncStart(
    channel: ChannelType,
    dataType: DataType,
  ): Promise<string> {
    const sessionId = `${channel}_${dataType}_${Date.now()}`;
    const record: SyncRecord = {
      sessionId,
      channel,
      dataType,
      startedAt: new Date(),
      status: 'in_progress',
    };

    // 히스토리에 기록
    const key = `${channel}_${dataType}`;
    if (!this.syncHistory.has(key)) {
      this.syncHistory.set(key, []);
    }
    this.syncHistory.get(key)!.unshift(record);

    // 최대 100개 기록만 유지
    if (this.syncHistory.get(key)!.length > 100) {
      this.syncHistory.get(key)!.pop();
    }

    this.logger.debug(`🚀 동기화 시작 기록: ${sessionId}`);
    return sessionId;
  }

  /**
   * 동기화 성공 완료 기록
   *
   * @param channel 채널 타입
   * @param dataType 데이터 타입
   * @param result 동기화 결과
   */
  async recordSyncComplete(
    channel: ChannelType,
    dataType: DataType,
    result: {
      eventCount: number;
      processingTime: number;
      sessionId?: string;
    },
  ): Promise<void> {
    const key = `${channel}_${dataType}`;
    const history = this.syncHistory.get(key) || [];

    // 세션 ID가 있으면 해당 기록 업데이트, 없으면 최신 기록 업데이트
    const recordIndex = result.sessionId
      ? history.findIndex((r) => r.sessionId === result.sessionId)
      : history.findIndex((r) => r.status === 'in_progress');

    if (recordIndex >= 0) {
      const record = history[recordIndex];
      record.status = 'success';
      record.completedAt = new Date();
      record.eventCount = result.eventCount;
      record.processingTime = result.processingTime;
      record.error = undefined;
    }

    // 채널 통계 업데이트
    this.updateChannelStats(channel, {
      totalSyncs: 1,
      successfulSyncs: 1,
      lastEventCount: result.eventCount,
      lastSyncAt: new Date(),
      processingTime: result.processingTime,
    });

    this.logger.debug(
      `✅ 동기화 완료 기록: ${channel}/${dataType} - ${result.eventCount}건 (${result.processingTime}ms)`,
    );
  }

  /**
   * 동기화 실패 기록
   *
   * @param channel 채널 타입
   * @param dataType 데이터 타입
   * @param error 실패 정보
   */
  async recordSyncFailure(
    channel: ChannelType,
    dataType: DataType,
    error: {
      message: string;
      processingTime?: number;
      sessionId?: string;
    },
  ): Promise<void> {
    const key = `${channel}_${dataType}`;
    const history = this.syncHistory.get(key) || [];

    // 세션 ID가 있으면 해당 기록 업데이트, 없으면 최신 기록 업데이트
    const recordIndex = error.sessionId
      ? history.findIndex((r) => r.sessionId === error.sessionId)
      : history.findIndex((r) => r.status === 'in_progress');

    if (recordIndex >= 0) {
      const record = history[recordIndex];
      record.status = 'failed';
      record.completedAt = new Date();
      record.error = error.message;
      record.processingTime = error.processingTime;
    }

    // 채널 통계 업데이트
    this.updateChannelStats(channel, {
      totalSyncs: 1,
      failedSyncs: 1,
      lastSyncAt: new Date(),
      processingTime: error.processingTime,
    });

    this.logger.warn(
      `❌ 동기화 실패 기록: ${channel}/${dataType} - ${error.message}`,
    );
  }

  /**
   * 특정 채널의 통계 조회
   *
   * @param channel 채널 타입
   * @returns 채널 통계
   */
  async getChannelStats(channel: ChannelType): Promise<ChannelStats | null> {
    return this.channelStats.get(channel) || null;
  }

  /**
   * 모든 채널의 통계 조회
   *
   * @returns 전체 채널 통계
   */
  async getAllChannelStats(): Promise<Record<string, ChannelStats>> {
    const result: Record<string, ChannelStats> = {};
    for (const [channel, stats] of this.channelStats.entries()) {
      result[channel] = stats;
    }
    return result;
  }

  /**
   * 특정 채널의 동기화 히스토리 조회
   *
   * @param channel 채널 타입
   * @param dataType 데이터 타입
   * @param limit 조회할 기록 수 (기본 50)
   * @returns 동기화 히스토리
   */
  async getSyncHistory(
    channel: ChannelType,
    dataType: DataType,
    limit: number = 50,
  ): Promise<SyncRecord[]> {
    const key = `${channel}_${dataType}`;
    const history = this.syncHistory.get(key) || [];
    return history.slice(0, Math.min(limit, history.length));
  }

  /**
   * 채널 통계 초기화
   */
  private initializeChannelStats(): void {
    const channels: ChannelType[] = ['naver_smartstore', 'coupang'];

    channels.forEach((channel) => {
      this.channelStats.set(channel, {
        channel,
        totalSyncs: 0,
        successfulSyncs: 0,
        failedSyncs: 0,
        lastEventCount: 0,
        lastSyncAt: null,
        avgProcessingTime: 0,
        status: 'idle',
      });
    });
  }

  /**
   * 채널 통계 업데이트
   *
   * @param channel 채널 타입
   * @param update 업데이트할 통계 정보
   */
  private updateChannelStats(
    channel: ChannelType,
    update: Partial<{
      totalSyncs: number;
      successfulSyncs: number;
      failedSyncs: number;
      lastEventCount: number;
      lastSyncAt: Date;
      processingTime: number;
    }>,
  ): void {
    const currentStats = this.channelStats.get(channel);
    if (!currentStats) return;

    // 누적 통계 업데이트
    if (update.totalSyncs) {
      currentStats.totalSyncs += update.totalSyncs;
    }
    if (update.successfulSyncs) {
      currentStats.successfulSyncs += update.successfulSyncs;
    }
    if (update.failedSyncs) {
      currentStats.failedSyncs += update.failedSyncs;
    }

    // 최신 정보 업데이트
    if (update.lastEventCount !== undefined) {
      currentStats.lastEventCount = update.lastEventCount;
    }
    if (update.lastSyncAt) {
      currentStats.lastSyncAt = update.lastSyncAt;
    }

    // 평균 처리 시간 계산
    if (update.processingTime && currentStats.totalSyncs > 0) {
      currentStats.avgProcessingTime = Math.round(
        (currentStats.avgProcessingTime * (currentStats.totalSyncs - 1) +
          update.processingTime) /
          currentStats.totalSyncs,
      );
    }

    // 상태 업데이트
    if (currentStats.failedSyncs > 0) {
      const failureRate =
        (currentStats.failedSyncs / currentStats.totalSyncs) * 100;
      currentStats.status = failureRate > 10 ? 'error' : 'warning';
    } else {
      currentStats.status = currentStats.totalSyncs > 0 ? 'active' : 'idle';
    }

    this.channelStats.set(channel, currentStats);
  }
}

/**
 * 동기화 기록 인터페이스
 */
export interface SyncRecord {
  sessionId: string;
  channel: ChannelType;
  dataType: DataType;
  status: 'in_progress' | 'success' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  eventCount?: number;
  processingTime?: number; // milliseconds
  error?: string;
}

/**
 * 채널 통계 인터페이스
 */
export interface ChannelStats {
  channel: ChannelType;
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  lastEventCount: number;
  lastSyncAt: Date | null;
  avgProcessingTime: number; // milliseconds
  status: 'idle' | 'active' | 'warning' | 'error';
}
