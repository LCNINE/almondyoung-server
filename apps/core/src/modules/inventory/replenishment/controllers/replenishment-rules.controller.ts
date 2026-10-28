import { Body, Controller, Delete, Get, HttpCode, Param, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@app/authorization';
import { ReplenishmentRulesService } from '../rules/replenishment-rules.service';
import {
  GradeRulesDto,
  LeadTimeRuleDto,
  ListSkuOverridesQueryDto,
  ReplenishmentSettingsDto,
  RouteRulesListDto,
  SkuOverrideRowDto,
  SkuOverridesListDto,
  SupplierRulesListDto,
  UpdateGradeRulesDto,
  UpdateReplenishmentSettingsDto,
  UpsertLeadTimeRuleDto,
  UpsertSkuOverrideDto,
} from '../dto/replenishment-rules.dto';

/**
 * 재고관리 규칙 CRUD (#743 B, 스펙 §6 · §7.4). 조회는 inventory.master.read, 쓰기는 inventory.master.write.
 * α · 리드타임 · 커버 · 예외는 저장 즉시 제안에 반영되고, 창 길이 · 임계 · 등급 컷 · D0 · 재계산 일수는
 * 다음 야간 배치 또는 POST /replenishment/profiles/recompute 에서 반영된다 — 화면이 항목마다 알린다.
 * 상태코드 매핑 try/catch 없음 — GlobalExceptionFilter 가 한다.
 */
@ApiTags('Inventory - Replenishment')
@Controller('replenishment/rules')
export class ReplenishmentRulesController {
  constructor(private readonly service: ReplenishmentRulesService) {}

  @RequirePermission('inventory.master.read')
  @Get('settings')
  @ApiOperation({
    summary: '전역 설정',
    description: '창 길이 · 임계 · 등급 컷 · D0 · 재계산 일수는 다음 야간 배치 또는 재계산 후에 반영된다.',
  })
  @ApiResponse({ status: 200, type: ReplenishmentSettingsDto })
  getSettings(): Promise<ReplenishmentSettingsDto> {
    return this.service.getSettings();
  }

  @RequirePermission('inventory.master.write')
  @Put('settings')
  @ApiOperation({
    summary: '전역 설정 부분 갱신',
    description:
      '리드타임 · 커버 기본값은 저장 즉시 반영. 창 길이 · 임계 · 등급 컷 · D0 · 재계산 일수는 프로필을 바꾸므로 ' +
      '다음 야간 배치 또는 POST /replenishment/profiles/recompute 에서 반영된다.',
  })
  @ApiResponse({ status: 200, type: ReplenishmentSettingsDto })
  @ApiResponse({ status: 400, description: '등급 컷 순서 등 모순' })
  updateSettings(@Body() dto: UpdateReplenishmentSettingsDto): Promise<ReplenishmentSettingsDto> {
    return this.service.updateSettings(dto);
  }

  @RequirePermission('inventory.master.read')
  @Get('grades')
  @ApiOperation({ summary: '등급별 α' })
  @ApiResponse({ status: 200, type: GradeRulesDto })
  getGrades(): Promise<GradeRulesDto> {
    return this.service.getGrades();
  }

  @RequirePermission('inventory.master.write')
  @Put('grades')
  @ApiOperation({ summary: '등급별 α 3행 일괄 — 저장 즉시 반영' })
  @ApiResponse({ status: 200, type: GradeRulesDto })
  @ApiResponse({ status: 400, description: 'A · B · C 세 행이 아니거나 α 가 (0, 1) 밖' })
  updateGrades(@Body() dto: UpdateGradeRulesDto): Promise<GradeRulesDto> {
    return this.service.updateGrades(dto.items);
  }

  @RequirePermission('inventory.master.read')
  @Get('suppliers')
  @ApiOperation({ summary: '공급사 목록 + 규칙 + 관측 프로필 — 규칙 없는 공급사도 포함' })
  @ApiResponse({ status: 200, type: SupplierRulesListDto })
  listSuppliers(): Promise<SupplierRulesListDto> {
    return this.service.listSuppliers();
  }

  @RequirePermission('inventory.master.write')
  @Put('suppliers/:supplierId')
  @ApiOperation({ summary: '공급사 규칙 upsert — 저장 즉시 반영' })
  @ApiParam({ name: 'supplierId' })
  @ApiResponse({ status: 200, type: LeadTimeRuleDto })
  @ApiResponse({ status: 404, description: '공급사 없음' })
  upsertSupplier(
    @Param('supplierId') supplierId: string,
    @Body() dto: UpsertLeadTimeRuleDto,
  ): Promise<LeadTimeRuleDto> {
    return this.service.upsertSupplier(supplierId, dto);
  }

  @RequirePermission('inventory.master.write')
  @Delete('suppliers/:supplierId')
  @HttpCode(204)
  @ApiOperation({ summary: '공급사 규칙 삭제 — 전역 기본으로 되돌린다' })
  @ApiParam({ name: 'supplierId' })
  @ApiResponse({ status: 404, description: '규칙 없음' })
  deleteSupplier(@Param('supplierId') supplierId: string): Promise<void> {
    return this.service.deleteSupplier(supplierId);
  }

  @RequirePermission('inventory.master.read')
  @Get('routes')
  @ApiOperation({ summary: '경로 규칙 ∪ 관측 경로' })
  @ApiResponse({ status: 200, type: RouteRulesListDto })
  listRoutes(): Promise<RouteRulesListDto> {
    return this.service.listRoutes();
  }

  @RequirePermission('inventory.master.write')
  @Put('routes/:fromWarehouseId/:toWarehouseId')
  @ApiOperation({ summary: '경로 규칙 upsert — 저장 즉시 반영' })
  @ApiParam({ name: 'fromWarehouseId' })
  @ApiParam({ name: 'toWarehouseId' })
  @ApiResponse({ status: 200, type: LeadTimeRuleDto })
  @ApiResponse({ status: 400, description: '출발 = 도착' })
  @ApiResponse({ status: 404, description: '창고 없음' })
  upsertRoute(
    @Param('fromWarehouseId') from: string,
    @Param('toWarehouseId') to: string,
    @Body() dto: UpsertLeadTimeRuleDto,
  ): Promise<LeadTimeRuleDto> {
    return this.service.upsertRoute(from, to, dto);
  }

  @RequirePermission('inventory.master.write')
  @Delete('routes/:fromWarehouseId/:toWarehouseId')
  @HttpCode(204)
  @ApiOperation({ summary: '경로 규칙 삭제 — 전역 이동 기본으로 되돌린다' })
  @ApiParam({ name: 'fromWarehouseId' })
  @ApiParam({ name: 'toWarehouseId' })
  @ApiResponse({ status: 404, description: '규칙 없음' })
  deleteRoute(@Param('fromWarehouseId') from: string, @Param('toWarehouseId') to: string): Promise<void> {
    return this.service.deleteRoute(from, to);
  }

  @RequirePermission('inventory.master.read')
  @Get('skus')
  @ApiOperation({ summary: 'SKU 예외 목록 — 코드 · 이름 검색' })
  @ApiResponse({ status: 200, type: SkuOverridesListDto })
  listSkuOverrides(@Query() query: ListSkuOverridesQueryDto): Promise<SkuOverridesListDto> {
    return this.service.listSkuOverrides(query.q, query.limit ?? 100);
  }

  @RequirePermission('inventory.master.write')
  @Put('skus/:skuId')
  @ApiOperation({ summary: 'SKU 예외 upsert — 저장 즉시 반영' })
  @ApiParam({ name: 'skuId' })
  @ApiResponse({ status: 200, type: SkuOverrideRowDto })
  @ApiResponse({ status: 400, description: 'α 가 (0, 1) 밖 등' })
  @ApiResponse({ status: 404, description: 'SKU 없음' })
  upsertSkuOverride(@Param('skuId') skuId: string, @Body() dto: UpsertSkuOverrideDto): Promise<SkuOverrideRowDto> {
    return this.service.upsertSkuOverride(skuId, dto);
  }

  @RequirePermission('inventory.master.write')
  @Delete('skus/:skuId')
  @HttpCode(204)
  @ApiOperation({ summary: 'SKU 예외 삭제 — auto 로 되돌린다' })
  @ApiParam({ name: 'skuId' })
  @ApiResponse({ status: 404, description: '예외 없음' })
  deleteSkuOverride(@Param('skuId') skuId: string): Promise<void> {
    return this.service.deleteSkuOverride(skuId);
  }
}
