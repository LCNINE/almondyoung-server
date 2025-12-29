// pim master id → medusa product id 매핑 관리

import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import { pimMedusaMappings } from '../../schema';
import type {
  PimMedusaMapping,
  NewPimMedusaMapping,
  UpdatePimMedusaMapping,
  ChannelAdapterSchema,
} from '../../types';

@Injectable()
export class PimMedusaMappingRepository {
  private readonly logger = new Logger(PimMedusaMappingRepository.name);

  constructor(
    private readonly dbService: DbService<ChannelAdapterSchema>,
  ) { }

  // pim master id로 매핑 조회
  async findByPimMasterId(pimMasterId: string): Promise<PimMedusaMapping | null> {
    const [mapping] = await this.dbService.db
      .select()
      .from(pimMedusaMappings)
      .where(eq(pimMedusaMappings.pimMasterId, pimMasterId))
      .limit(1);

    return mapping || null;
  }

  // medusa product id로 매핑 조회
  async findByMedusaProductId(medusaProductId: string): Promise<PimMedusaMapping | null> {
    const [mapping] = await this.dbService.db
      .select()
      .from(pimMedusaMappings)
      .where(eq(pimMedusaMappings.medusaProductId, medusaProductId))
      .limit(1);

    return mapping || null;
  }

  // 매핑 생성
  async create(data: NewPimMedusaMapping): Promise<PimMedusaMapping> {
    const [mapping] = await this.dbService.db
      .insert(pimMedusaMappings)
      .values(data)
      .returning();

    this.logger.log(`Created mapping: ${data.pimMasterId} → ${data.medusaProductId}`);
    return mapping;
  }

  // 매핑 업데이트
  async update(
    pimMasterId: string,
    data: UpdatePimMedusaMapping,
  ): Promise<PimMedusaMapping> {
    const [mapping] = await this.dbService.db
      .update(pimMedusaMappings)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(pimMedusaMappings.pimMasterId, pimMasterId))
      .returning();

    return mapping;
  }

  // 동기화 성공 기록
  async recordSuccess(
    pimMasterId: string,
    data: {
      pimVersionId: string;
      pimVersion: number;
      medusaProductId: string;
      medusaHandle: string;
      action: 'created' | 'updated';
    },
  ): Promise<void> {
    const existing = await this.findByPimMasterId(pimMasterId);

    if (!existing) {
      // 신규 생성
      await this.create({
        pimMasterId,
        pimVersionId: data.pimVersionId,
        pimVersion: data.pimVersion,
        medusaProductId: data.medusaProductId,
        medusaHandle: data.medusaHandle,
        syncStatus: 'synced',
        lastSyncAction: data.action,
        syncErrorCount: 0,
        lastSyncError: null,
      });
    } else {
      // 업데이트
      await this.update(pimMasterId, {
        pimVersionId: data.pimVersionId,
        pimVersion: data.pimVersion,
        medusaProductId: data.medusaProductId,
        medusaHandle: data.medusaHandle,
        syncStatus: 'synced',
        lastSyncedAt: new Date(),
        lastSyncAction: data.action,
        syncErrorCount: 0, // 성공 시 에러 카운트 리셋
        lastSyncError: null,
      });
    }
  }

  // 동기화 실패 기록
  async recordFailure(
    pimMasterId: string,
    data: {
      pimVersionId: string;
      pimVersion: number;
      error: string;
    },
  ): Promise<void> {
    const existing = await this.findByPimMasterId(pimMasterId);

    if (!existing) {
      // 신규 생성 (실패)
      await this.create({
        pimMasterId,
        pimVersionId: data.pimVersionId,
        pimVersion: data.pimVersion,
        medusaProductId: null,
        medusaHandle: null,
        syncStatus: 'failed',
        syncErrorCount: 1,
        lastSyncError: data.error,
      });
    } else {
      // 업데이트(에러 카운트 증가)
      await this.update(pimMasterId, {
        pimVersionId: data.pimVersionId,
        pimVersion: data.pimVersion,
        syncStatus: 'failed',
        lastSyncedAt: new Date(),
        syncErrorCount: (existing.syncErrorCount || 0) + 1,
        lastSyncError: data.error,
      });
    }
  }

  // 버전 기반 순서 제어: 이미 반영된 버전보다 낮으면 skip
  async shouldProcess(pimMasterId: string, newVersion: number): Promise<boolean> {
    const existing = await this.findByPimMasterId(pimMasterId);

    if (!existing || existing.pimVersion === null || existing.pimVersion === undefined) {
      // 매핑이 없거나 버전 정보가 없으면 처리
      return true;
    }

    if (newVersion <= existing.pimVersion) {
      this.logger.warn(
        `Skipping stale event: ${pimMasterId} (new: v${newVersion}, existing: v${existing.pimVersion})`,
      );
      return false;
    }

    return true;
  }
}

