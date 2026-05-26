import { Injectable, Logger } from '@nestjs/common';
import { ChannelType } from '../adapters/channel-adapter.factory';
import { DataType, NewSyncStatus, SyncStatus, UpdateSyncStatus, ChannelAdapterSchema } from '../types';
import { eq, and } from 'drizzle-orm';
import { DbService } from '@app/db';
import { channelAdapterSchema } from '../schema';

/**
 * 채널별 동기화 상태 및 통계 관리 서비스 (PostgreSQL 기반)
 *
 * 각 판매채널의 동기화 이력, 성공/실패 통계, 성능 지표를 PostgreSQL에 영속화하여 관리합니다.
 * CTO SoT 원칙에 따라 동기화 상태를 신뢰할 수 있는 단일 소스로 관리합니다.
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
 * // 채널별 통계 조회 (DB에서 조회)
 * const stats = await syncStatusService.getChannelStats('naver_smartstore');
 * ```
 */
@Injectable()
export class SyncStatusService {
  private readonly logger = new Logger(SyncStatusService.name);

  constructor(private readonly db: DbService<typeof channelAdapterSchema>) {
    this.logger.log('📊 동기화 상태 서비스 초기화 완료 (PostgreSQL 기반)');
  }

  /**
   * 동기화 시작 기록
   *
   * @param channel 채널 타입
   * @param dataType 데이터 타입
   * @returns 동기화 세션 ID
   */
  async recordSyncStart(channel: ChannelType, dataType: DataType): Promise<string> {
    const sessionId = `${channel}_${dataType}_${Date.now()}`;

    try {
      // sync_statuses 테이블에서 기존 레코드 조회 또는 생성
      await this.upsertSyncStatus(channel, dataType, {
        status: 'in_progress',
      });

      this.logger.debug(`🚀 동기화 시작 기록: ${sessionId}`);
      return sessionId;
    } catch (error) {
      this.logger.error(`❌ 동기화 시작 기록 실패: ${sessionId}`, error.message);
      throw new Error(`동기화 시작 기록 실패: ${error.message}`);
    }
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
      watermark?: Date | null;
    },
  ): Promise<void> {
    try {
      // 기존 통계 조회
      const currentStats = await this.getSyncStatusRecord(channel, dataType);

      // 새로운 평균 처리 시간 계산
      const newTotalSyncs = (currentStats?.totalSyncs || 0) + 1;
      const newAvgProcessingTime = currentStats
        ? Math.round(
            ((currentStats.avgProcessingTimeMs || 0) * (currentStats.totalSyncs || 0) + result.processingTime) /
              newTotalSyncs,
          )
        : result.processingTime;

      const updates: Partial<UpdateSyncStatus> = {
        status: 'success',
        lastEventCount: result.eventCount,
        totalSyncs: newTotalSyncs,
        successfulSyncs: (currentStats?.successfulSyncs || 0) + 1,
        avgProcessingTimeMs: newAvgProcessingTime,
        lastErrorMessage: null, // 성공 시 에러 메시지 클리어
      };

      if (result.watermark !== null) {
        updates.lastSyncAt = result.watermark ?? new Date();
      }

      // sync_statuses 테이블 업데이트
      await this.upsertSyncStatus(channel, dataType, updates);

      this.logger.debug(
        `✅ 동기화 완료 기록: ${channel}/${dataType} - ${result.eventCount}건 (${result.processingTime}ms)`,
      );
    } catch (error) {
      this.logger.error(`❌ 동기화 완료 기록 실패: ${channel}/${dataType}`, error.message);
      throw new Error(`동기화 완료 기록 실패: ${error.message}`);
    }
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
    try {
      // 기존 통계 조회
      const currentStats = await this.getSyncStatusRecord(channel, dataType);

      // 새로운 평균 처리 시간 계산 (실패한 경우에도 포함)
      const newTotalSyncs = (currentStats?.totalSyncs || 0) + 1;
      const newAvgProcessingTime =
        currentStats && error.processingTime
          ? Math.round(
              ((currentStats.avgProcessingTimeMs || 0) * (currentStats.totalSyncs || 0) + error.processingTime) /
                newTotalSyncs,
            )
          : currentStats?.avgProcessingTimeMs || 0;

      // sync_statuses 테이블 업데이트
      await this.upsertSyncStatus(channel, dataType, {
        status: 'failed',
        totalSyncs: newTotalSyncs,
        failedSyncs: (currentStats?.failedSyncs || 0) + 1,
        avgProcessingTimeMs: newAvgProcessingTime,
        lastErrorMessage: error.message,
      });

      this.logger.warn(`❌ 동기화 실패 기록: ${channel}/${dataType} - ${error.message}`);
    } catch (dbError) {
      this.logger.error(`❌ 동기화 실패 기록 중 DB 오류: ${channel}/${dataType}`, dbError.message);
      throw new Error(`동기화 실패 기록 중 DB 오류: ${dbError.message}`);
    }
  }

  /**
   * 특정 채널의 통계 조회
   *
   * @param channel 채널 타입
   * @returns 채널 통계
   */
  async getChannelStats(channel: ChannelType): Promise<ChannelStats | null> {
    try {
      const records = await this.db.db
        .select()
        .from(channelAdapterSchema.syncStatuses)
        .where(eq(channelAdapterSchema.syncStatuses.channelId, channel));

      if (records.length === 0) {
        return null;
      }

      // 모든 데이터 타입의 통계를 합산
      const aggregatedStats = this.aggregateChannelStats(channel, records);
      return aggregatedStats;
    } catch (error) {
      this.logger.error(`❌ 채널 통계 조회 실패: ${channel}`, error.message);
      throw new Error(`채널 통계 조회 실패: ${error.message}`);
    }
  }

  /**
   * 모든 채널의 통계 조회
   *
   * @returns 전체 채널 통계
   */
  async getAllChannelStats(): Promise<Record<string, ChannelStats>> {
    try {
      const allRecords = await this.db.db.select().from(channelAdapterSchema.syncStatuses);

      const result: Record<string, ChannelStats> = {};
      const channelGroups = this.groupRecordsByChannel(allRecords);

      for (const [channel, records] of channelGroups.entries()) {
        result[channel] = this.aggregateChannelStats(channel as ChannelType, records);
      }

      return result;
    } catch (error) {
      this.logger.error(`❌ 전체 채널 통계 조회 실패`, error.message);
      throw new Error(`전체 채널 통계 조회 실패: ${error.message}`);
    }
  }

  /**
   * 특정 채널+데이터타입의 동기화 상태 조회
   *
   * @param channel 채널 타입
   * @param dataType 데이터 타입
   * @returns 동기화 상태 레코드
   */
  async getSyncStatus(channel: ChannelType, dataType: DataType): Promise<SyncStatus | null> {
    try {
      const [record] = await this.db.db
        .select()
        .from(channelAdapterSchema.syncStatuses)
        .where(
          and(
            eq(channelAdapterSchema.syncStatuses.channelId, channel),
            eq(channelAdapterSchema.syncStatuses.dataType, dataType),
          ),
        )
        .limit(1);

      return record || null;
    } catch (error) {
      this.logger.error(`❌ 동기화 상태 조회 실패: ${channel}/${dataType}`, error.message);
      throw new Error(`동기화 상태 조회 실패: ${error.message}`);
    }
  }

  // ===== 내부 헬퍼 메서드들 =====

  /**
   * sync_statuses 테이블 upsert (생성 또는 업데이트)
   *
   * @param channel 채널 타입
   * @param dataType 데이터 타입
   * @param updates 업데이트할 필드들
   */
  private async upsertSyncStatus(
    channel: ChannelType,
    dataType: DataType,
    updates: Partial<UpdateSyncStatus>,
  ): Promise<void> {
    try {
      // 기존 레코드 확인
      const existing = await this.getSyncStatusRecord(channel, dataType);

      if (existing) {
        // 업데이트
        await this.db.db
          .update(channelAdapterSchema.syncStatuses)
          .set({
            ...updates,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(channelAdapterSchema.syncStatuses.channelId, channel),
              eq(channelAdapterSchema.syncStatuses.dataType, dataType),
            ),
          );
      } else {
        // 생성
        const newRecord: NewSyncStatus = {
          channelId: channel,
          dataType,
          status: 'idle',
          totalSyncs: 0,
          successfulSyncs: 0,
          failedSyncs: 0,
          lastEventCount: 0,
          avgProcessingTimeMs: 0,
          ...updates,
        };

        await this.db.db.insert(channelAdapterSchema.syncStatuses).values(newRecord);
      }
    } catch (error) {
      this.logger.error(`❌ sync_statuses upsert 실패: ${channel}/${dataType}`, error.message);
      throw new Error(`sync_statuses upsert 실패: ${error.message}`);
    }
  }

  /**
   * sync_statuses 테이블에서 레코드 조회 (내부용)
   */
  private async getSyncStatusRecord(channel: ChannelType, dataType: DataType): Promise<SyncStatus | null> {
    try {
      const [record] = await this.db.db
        .select()
        .from(channelAdapterSchema.syncStatuses)
        .where(
          and(
            eq(channelAdapterSchema.syncStatuses.channelId, channel),
            eq(channelAdapterSchema.syncStatuses.dataType, dataType),
          ),
        )
        .limit(1);

      return record || null;
    } catch (error) {
      this.logger.error(`❌ sync_statuses 레코드 조회 실패: ${channel}/${dataType}`, error.message);
      return null;
    }
  }

  /**
   * 채널별 통계 집계
   */
  private aggregateChannelStats(channel: ChannelType, records: SyncStatus[]): ChannelStats {
    const totalSyncs = records.reduce((sum, r) => sum + (r.totalSyncs || 0), 0);
    const successfulSyncs = records.reduce((sum, r) => sum + (r.successfulSyncs || 0), 0);
    const failedSyncs = records.reduce((sum, r) => sum + (r.failedSyncs || 0), 0);

    // 가장 최근 동기화 시각
    const lastSyncAt = records.reduce(
      (latest, r) => {
        if (!r.lastSyncAt) return latest;
        if (!latest) return r.lastSyncAt;
        return r.lastSyncAt > latest ? r.lastSyncAt : latest;
      },
      null as Date | null,
    );

    // 평균 처리 시간 (가중 평균)
    const avgProcessingTime =
      records.length > 0
        ? Math.round(records.reduce((sum, r) => sum + (r.avgProcessingTimeMs || 0), 0) / records.length)
        : 0;

    // 마지막 이벤트 수 (가장 최근 동기화의 이벤트 수)
    const lastEventCount = records.reduce((latest, r) => {
      if (!r.lastSyncAt) return latest;
      return r.lastEventCount || 0;
    }, 0);

    // 전체 상태 결정
    let status: ChannelStats['status'] = 'idle';
    if (totalSyncs > 0) {
      const failureRate = totalSyncs > 0 ? (failedSyncs / totalSyncs) * 100 : 0;
      if (failureRate > 10) {
        status = 'error';
      } else if (failureRate > 0) {
        status = 'warning';
      } else {
        status = 'active';
      }
    }

    return {
      channel,
      totalSyncs,
      successfulSyncs,
      failedSyncs,
      lastEventCount,
      lastSyncAt,
      avgProcessingTime,
      status,
    };
  }

  /**
   * 레코드들을 채널별로 그룹화
   */
  private groupRecordsByChannel(records: SyncStatus[]): Map<string, SyncStatus[]> {
    const groups = new Map<string, SyncStatus[]>();

    for (const record of records) {
      if (!groups.has(record.channelId)) {
        groups.set(record.channelId, []);
      }
      groups.get(record.channelId)!.push(record);
    }

    return groups;
  }

  /**
   * 특정 채널과 데이터 타입의 동기화 히스토리 조회
   *
   * @param channel 채널 타입
   * @param dataType 데이터 타입
   * @param limit 조회 제한 (기본값: 50)
   * @returns 동기화 히스토리 배열
   */
  async getSyncHistory(channel: ChannelType, dataType: DataType, limit: number = 50): Promise<SyncStatus[]> {
    try {
      const history = await this.db.db
        .select()
        .from(channelAdapterSchema.syncStatuses)
        .where(
          and(
            eq(channelAdapterSchema.syncStatuses.channelId, channel),
            eq(channelAdapterSchema.syncStatuses.dataType, dataType),
          ),
        )
        .orderBy(channelAdapterSchema.syncStatuses.updatedAt)
        .limit(limit);

      this.logger.debug(`📋 동기화 히스토리 조회: ${channel}/${dataType} - ${history.length}건`);

      return history;
    } catch (error) {
      this.logger.error(`❌ 동기화 히스토리 조회 실패: ${channel}/${dataType}`, error.message);
      throw new Error(`동기화 히스토리 조회 실패: ${error.message}`);
    }
  }
}

/**
 * 채널 통계 인터페이스 (집계된 통계)
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
