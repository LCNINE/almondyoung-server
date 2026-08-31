import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PimMedusaMappingRepository } from '../adapters/medusa/pim-medusa-mapping.repository';

/** 한 번에 조회할 수 있는 masterId 상한 — 무제한 배열을 받으면 그 자체가 부하 문이 된다. */
export const MAPPING_LOOKUP_MAX_IDS = 100;

export interface PimMedusaMappingRow {
  pimMasterId: string;
  medusaProductId: string | null;
  medusaHandle: string | null;
  syncStatus: string | null;
  lastSyncedAt: string | null;
}

/**
 * PIM masterId → Medusa product id 매핑 조회 (읽기 전용).
 *
 * 관리자 화면이 GA4 의 `item_id`(= Medusa product id)와 우리 상품(masterId)을 잇는 데 쓴다.
 * 이름으로 이으면 개명·동명 상품에서 깨지므로 매핑 표가 유일한 정답이다.
 *
 * 인가 데코레이터가 없는 게 의도다 — 이 앱은 전역 `AdminRealmGuard` 가 표시 없는 라우트를
 * 직원(admin/master) 전용으로 기본 차단한다(`event-trace.controller.ts` 와 같은 규격).
 * **쓰기 라우트는 두지 않는다.** 매핑은 동기화 파이프라인만 쓴다.
 */
@ApiTags('adapter-pim-medusa-mappings')
@Controller('adapter/pim-medusa-mappings')
export class PimMedusaMappingController {
  constructor(private readonly mappingRepository: PimMedusaMappingRepository) {}

  @Get()
  @ApiOperation({ summary: 'PIM masterId 로 Medusa 상품 매핑 조회 (쉼표 구분, 최대 100개)' })
  async list(@Query('masterIds') masterIds?: string): Promise<{ mappings: PimMedusaMappingRow[] }> {
    const ids = [...new Set((masterIds ?? '').split(',').map((id) => id.trim()).filter(Boolean))];
    if (ids.length === 0) {
      throw new BadRequestException('masterIds 는 필수입니다 (쉼표 구분)');
    }
    if (ids.length > MAPPING_LOOKUP_MAX_IDS) {
      throw new BadRequestException(`masterIds 는 최대 ${MAPPING_LOOKUP_MAX_IDS}개까지 조회할 수 있습니다`);
    }

    const rows = await this.mappingRepository.findByPimMasterIds(ids);
    return {
      mappings: rows.map((row) => ({
        pimMasterId: row.pimMasterId,
        medusaProductId: row.medusaProductId ?? null,
        medusaHandle: row.medusaHandle ?? null,
        syncStatus: row.syncStatus ?? null,
        lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
      })),
    };
  }
}
