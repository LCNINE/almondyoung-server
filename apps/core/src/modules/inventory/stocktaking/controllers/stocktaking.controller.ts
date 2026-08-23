import { Controller, Get, Post, Put, Param, Body, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard } from '@app/authorization';
import { INVENTORY_SCOPE } from '../../../../platform/auth/inventory-scopes';
import { StocktakingService } from '../services/stocktaking.service';
import { CreateStocktakingSessionDto } from '../dto/create-session.dto';
import { ListStocktakingSessionsQueryDto } from '../dto/list-sessions-query.dto';
import { ScanLocationDto } from '../dto/scan-location.dto';
import { ScanProductDto } from '../dto/scan-product.dto';
import { UpdateCountDto } from '../dto/update-count.dto';
import { GenerateAdjustmentsDto } from '../dto/generate-adjustments.dto';
import { StocktakingSessionDetailDto } from '../dto/session-detail.dto';

@ApiTags('Stocktaking')
@Controller('stocktaking')
@UseGuards(ScopeGuard)
export class StocktakingController {
  constructor(private readonly stocktakingService: StocktakingService) {}

  @Get('sessions')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '재고 실사 세션 목록 조회 (List stocktaking sessions)' })
  @ApiResponse({ status: 200, description: 'Paginated list of sessions' })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async listSessions(@Query() query: ListStocktakingSessionsQueryDto) {
    return this.stocktakingService.listSessions(query);
  }

  @Get('sessions/:id')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '재고 실사 세션 상세 조회 (세션 + 전체 라인 + 진행률)' })
  @ApiParam({ name: 'id', description: '세션 ID' })
  @ApiResponse({ status: 200, type: StocktakingSessionDetailDto })
  @ApiResponse({ status: 404, description: '세션을 찾을 수 없음' })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async getSession(@Param('id') id: string): Promise<StocktakingSessionDetailDto> {
    return this.stocktakingService.getSession(id);
  }

  @Post('sessions')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '재고 실사 세션 생성 (Create stocktaking session)' })
  @ApiResponse({ status: 201, description: 'Session created successfully' })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async createSession(@Body() dto: CreateStocktakingSessionDto) {
    return this.stocktakingService.createSession(dto);
  }

  @Post('sessions/:id/start')
  @HttpCode(HttpStatus.OK)
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '재고 실사 시작 (Start stocktaking session)' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Session started' })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async startSession(@Param('id') id: string) {
    return this.stocktakingService.startSession(id);
  }

  @Post('scan-location')
  @HttpCode(HttpStatus.OK)
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '위치 바코드 스캔 (Scan location barcode)' })
  @ApiResponse({ status: 200, description: 'Location scanned, expected items loaded' })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async scanLocation(@Body() dto: ScanLocationDto) {
    return this.stocktakingService.scanLocation(dto);
  }

  @Post('scan-product')
  @HttpCode(HttpStatus.OK)
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '상품 바코드 스캔 (Scan product barcode)' })
  @ApiResponse({ status: 200, description: 'Product scanned, count updated' })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async scanProduct(@Body() dto: ScanProductDto) {
    return this.stocktakingService.scanProduct(dto);
  }

  @Put('lines/:id/count')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '수량 수동 입력 (Update count manually)' })
  @ApiParam({ name: 'id', description: 'Line ID' })
  @ApiResponse({ status: 200, description: 'Count updated' })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async updateCount(@Param('id') id: string, @Body() dto: UpdateCountDto) {
    return this.stocktakingService.updateCount(id, dto);
  }

  @Get('sessions/:id/variances')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '차이 조회 (Get variances/discrepancies)' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'List of variances' })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async getVariances(@Param('id') id: string) {
    return this.stocktakingService.getVariances(id);
  }

  @Post('sessions/:id/generate-adjustments')
  @HttpCode(HttpStatus.OK)
  @RequireScopes(INVENTORY_SCOPE.ADJUST)
  @ApiOperation({ summary: '조정 자동 생성 (Generate stock adjustments)' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Adjustments generated' })
  @ApiResponse({ status: 403, description: '재고 원장 조정 권한이 없습니다.' })
  async generateAdjustments(@Param('id') id: string, @Body() dto: GenerateAdjustmentsDto) {
    return this.stocktakingService.generateAdjustments(id, dto);
  }

  @Post('sessions/:id/complete')
  @HttpCode(HttpStatus.OK)
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '재고 실사 완료 (Complete stocktaking session)' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Session completed with summary' })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async completeSession(@Param('id') id: string) {
    return this.stocktakingService.completeSession(id);
  }

  @Post('sessions/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '재고 실사 취소 (Cancel stocktaking session)' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Session cancelled' })
  @ApiResponse({ status: 403, description: '재고 현장 작업 권한이 없습니다.' })
  async cancelSession(@Param('id') id: string) {
    return this.stocktakingService.cancelSession(id);
  }
}
