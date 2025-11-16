import {
  Controller,
  Get,
  Query,
  Param,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { SavingsService } from '../services/savings/savings.service';
import { MonthlySavingsDto, RangeSavingsDto } from '../shared/dto/savings.dto';
import { JwtAuthGuard } from '../../../../libs/auth-core/src/guards/jwt-auth.guard';
import { User } from '../../../../libs/auth-core/src/decorators/user.decorator';

/**
 * 멤버십 절약액 조회 컨트롤러
 *
 * 사용자의 월별/기간별 멤버십 절약액을 조회하는 API
 */
@ApiTags('savings')
@Controller('membership/savings')
@UseGuards(JwtAuthGuard)
export class SavingsController {
  constructor(private readonly savingsService: SavingsService) {}

  /**
   * 이번달 절약액 조회
   */
  @Get('current-month')
  @ApiOperation({
    summary: '이번달 절약액 조회',
    description: '사용자의 이번달 멤버십으로 절약한 금액을 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '이번달 절약액 조회 성공',
    type: MonthlySavingsDto,
  })
  async getCurrentMonthSavings(
    @User('userId') userId: string,
  ): Promise<MonthlySavingsDto> {
    return this.savingsService.getCurrentMonthSavings(userId);
  }

  /**
   * 특정 월 절약액 조회
   */
  @Get('month/:yearMonth')
  @ApiOperation({
    summary: '특정 월 절약액 조회',
    description: '지정된 년월의 멤버십 절약액을 조회합니다.',
  })
  @ApiParam({
    name: 'yearMonth',
    description: '조회할 년월 (YYYY-MM 형식)',
    example: '2025-11',
  })
  @ApiResponse({
    status: 200,
    description: '월별 절약액 조회 성공',
    type: MonthlySavingsDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 yearMonth 형식',
  })
  async getMonthSavings(
    @User('userId') userId: string,
    @Param('yearMonth') yearMonth: string,
  ): Promise<MonthlySavingsDto> {
    // Validation: YYYY-MM 형식 체크
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
      throw new BadRequestException(
        'Invalid yearMonth format. Use YYYY-MM (e.g., 2025-11)',
      );
    }

    return this.savingsService.getMonthSavings(userId, yearMonth);
  }

  /**
   * 기간별 절약액 조회
   */
  @Get('range')
  @ApiOperation({
    summary: '기간별 절약액 조회',
    description:
      '지정된 기간의 멤버십 절약액을 조회합니다. 월별 breakdown 포함.',
  })
  @ApiQuery({
    name: 'startDate',
    description: '시작일 (ISO 8601 형식, 예: 2025-09-01)',
    example: '2025-09-01',
  })
  @ApiQuery({
    name: 'endDate',
    description: '종료일 (ISO 8601 형식, 예: 2025-11-30)',
    example: '2025-11-30',
  })
  @ApiResponse({
    status: 200,
    description: '기간별 절약액 조회 성공',
    type: RangeSavingsDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 날짜 형식 또는 startDate > endDate',
  })
  async getRangeSavings(
    @User('userId') userId: string,
    @Query('startDate') startDateStr: string,
    @Query('endDate') endDateStr: string,
  ): Promise<RangeSavingsDto> {
    if (!startDateStr || !endDateStr) {
      throw new BadRequestException(
        'startDate and endDate query parameters are required',
      );
    }

    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new BadRequestException(
        'Invalid date format. Use ISO 8601 format (e.g., 2025-09-01)',
      );
    }

    if (startDate > endDate) {
      throw new BadRequestException(
        'startDate must be before or equal to endDate',
      );
    }

    return this.savingsService.getRangeSavings(userId, startDate, endDate);
  }
}
