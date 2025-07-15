import { Controller, Get, Query, Patch, Param, Body } from '@nestjs/common';
import { ProductMatchingService } from './product-matching.service';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { ResolveMatchingDto } from './dto/resolve-matching.dto';
import { SetMatchingPriorityDto } from './dto/set-matching-priority.dto';
import { matchingStatusEnum } from '../../database/schemas/wms-schema';

@ApiTags('Product Matching')
@Controller('wms/matchings')
export class ProductMatchingController {
  constructor(private readonly productMatchingService: ProductMatchingService) { }

  @Get()
  @ApiOperation({ summary: '매칭 대기 목록 조회' })
  @ApiQuery({ name: 'status', enum: matchingStatusEnum.enumValues, required: false, description: '매칭 상태 필터 (pending, matched, ignored)' })
  @ApiResponse({ status: 200, description: '매칭 대기 목록을 반환합니다.' })
  async getMatchingPendings(@Query('status') status?: typeof matchingStatusEnum.enumValues[number]) {
    return this.productMatchingService.getMatchingPendings(status);
  }

  @Patch(':id/resolve')
  @ApiOperation({ summary: '매칭 대기 해소 (SKU와 매칭 또는 무시)' })
  @ApiResponse({ status: 200, description: '매칭 대기가 성공적으로 해소되었습니다.' })
  async resolveMatchingPending(@Param('id') matchingId: string, @Body() resolveDto: ResolveMatchingDto) {
    return this.productMatchingService.resolveMatchingPending(matchingId, resolveDto);
  }

  @Patch(':id/priority')
  @ApiOperation({ summary: '매칭 대기 우선순위 설정' })
  @ApiResponse({ status: 200, description: '매칭 우선순위가 설정되었습니다.' })
  async setMatchingPriority(@Param('id') matchingId: string, @Body() priorityDto: SetMatchingPriorityDto) {
    return this.productMatchingService.setMatchingPriority(matchingId, priorityDto.priority);
  }
}