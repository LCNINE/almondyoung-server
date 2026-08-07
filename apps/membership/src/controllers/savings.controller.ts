import { Controller, Get, Query, Param, BadRequestException, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam } from '@nestjs/swagger';
import {
  SavingsService,
  type SavingsOverviewDto,
  type SavingsPeriodDetailDto,
} from '../services/savings/savings.service';
import { MonthlySavingsDto, RangeSavingsDto } from '../shared/dto/savings.dto';
import { JwtAuthGuard, User } from '@app/authorization';

/**
 * 멤버십 절약액 조회 컨트롤러
 *
 * 기본 단위는 **결제 주기**다. 환불 가능 여부가 결제 주기 기준으로 판정되므로, 고객이 보는 절약액도
 * 같은 경계로 끊어야 "화면엔 절약했다는데 환불은 왜 막히나" 가 생기지 않는다.
 */
@ApiTags('savings')
@Controller('membership/savings')
@UseGuards(JwtAuthGuard)
export class SavingsController {
  constructor(private readonly savingsService: SavingsService) {}

  /**
   * 결제 주기별 절약액 목록 + 전체 누적
   */
  @Get('overview')
  @ApiOperation({
    summary: '결제 주기별 절약액 조회',
    description: '현재 주기, 과거 주기 목록, 전체 누적 절약액을 함께 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '주기별 절약액 조회 성공' })
  async getOverview(@User('userId') userId: string): Promise<SavingsOverviewDto> {
    return this.savingsService.getOverview(userId);
  }

  /**
   * 특정 결제 주기의 절약 내역 (주문별 상세 포함)
   */
  @Get('periods/:periodId')
  @ApiOperation({
    summary: '결제 주기 절약 상세 조회',
    description: '해당 주기의 절약액 합계와 주문별 할인 내역을 조회합니다.',
  })
  @ApiParam({ name: 'periodId', description: 'overview 가 내려준 주기 id', example: 'a1b2:3' })
  @ApiResponse({ status: 200, description: '주기 상세 조회 성공' })
  @ApiResponse({ status: 400, description: '존재하지 않는 주기' })
  async getPeriodDetail(
    @User('userId') userId: string,
    @Param('periodId') periodId: string,
  ): Promise<SavingsPeriodDetailDto> {
    return this.savingsService.getPeriodDetail(userId, periodId);
  }

  /**
   * 이번달 절약액 조회
   *
   * @deprecated 신규 화면은 `overview` 를 쓴다. 배포 과도기에 옛 스토어프론트가 이 경로를 부르므로
   * 남겨둔다 — 지우면 롤아웃 중인 옛 화면의 절약액이 0으로 보인다.
   */
  @Get('current-month')
  @ApiOperation({
    summary: '이번달 절약액 조회 (deprecated)',
    description: '달력 월 기준. 환불 판정 기간과 경계가 달라 신규 화면에서는 사용하지 않습니다.',
  })
  @ApiResponse({ status: 200, description: '이번달 절약액 조회 성공', type: MonthlySavingsDto })
  async getCurrentMonthSavings(@User('userId') userId: string) {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return this.savingsService.getMonthSavings(userId, yearMonth);
  }

  /**
   * 특정 월 절약액 조회
   *
   * @deprecated 달력 월은 환불 판정 기간과 경계가 다르다. 신규 화면은 `overview` 를 쓴다.
   */
  @Get('month/:yearMonth')
  @ApiOperation({
    summary: '특정 월 절약액 조회 (deprecated)',
    description: '달력 월 기준. 환불 판정 기간과 경계가 달라 신규 화면에서는 사용하지 않습니다.',
  })
  @ApiParam({ name: 'yearMonth', description: '조회할 년월 (YYYY-MM 형식)', example: '2026-08' })
  @ApiResponse({ status: 200, description: '월별 절약액 조회 성공', type: MonthlySavingsDto })
  @ApiResponse({ status: 400, description: '잘못된 yearMonth 형식' })
  async getMonthSavings(@User('userId') userId: string, @Param('yearMonth') yearMonth: string) {
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
      throw new BadRequestException('Invalid yearMonth format. Use YYYY-MM (e.g., 2026-08)');
    }

    return this.savingsService.getMonthSavings(userId, yearMonth);
  }

  /**
   * 기간별 절약액 조회
   */
  @Get('range')
  @ApiOperation({
    summary: '기간별 절약액 조회',
    description: '지정된 기간의 멤버십 절약액을 조회합니다. 월별 breakdown 포함.',
  })
  @ApiQuery({ name: 'startDate', description: '시작일 (ISO 8601 형식, 예: 2026-06-01)', example: '2026-06-01' })
  @ApiQuery({ name: 'endDate', description: '종료일 (ISO 8601 형식, 예: 2026-08-31)', example: '2026-08-31' })
  @ApiResponse({ status: 200, description: '기간별 절약액 조회 성공', type: RangeSavingsDto })
  @ApiResponse({ status: 400, description: '잘못된 날짜 형식 또는 startDate > endDate' })
  async getRangeSavings(
    @User('userId') userId: string,
    @Query('startDate') startDateStr: string,
    @Query('endDate') endDateStr: string,
  ) {
    if (!startDateStr || !endDateStr) {
      throw new BadRequestException('startDate and endDate query parameters are required');
    }

    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new BadRequestException('Invalid date format. Use ISO 8601 format (e.g., 2026-06-01)');
    }

    if (startDate > endDate) {
      throw new BadRequestException('startDate must be before or equal to endDate');
    }

    return this.savingsService.getRangeSavings(userId, startDate, endDate);
  }
}
