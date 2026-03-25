import { Controller, Get, Put, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { MatchingsService } from '../services/matchings.service';
import { UpsertMatchingDto } from '../dto/upsert-matching.dto';

@ApiTags('Product Matchings')
@Controller('matchings')
export class MatchingsController {
  constructor(private readonly service: MatchingsService) {}

  @Get(':variantId')
  get(@Param('variantId') variantId: string) {
    return this.service.getByVariant(variantId);
  }

  @Put(':variantId')
  upsert(@Param('variantId') variantId: string, @Body() dto: UpsertMatchingDto) {
    return this.service.upsert(variantId, dto);
  }

  @Get('masters/batch-stats')
  @ApiOperation({
    summary: '마스터별 매칭 통계 일괄 조회',
    description: '여러 마스터의 variant 매칭 상태를 한 번에 조회합니다.',
  })
  @ApiQuery({
    name: 'masterIds',
    description: 'Comma-separated master IDs',
    example: 'uuid1,uuid2,uuid3',
    required: true,
  })
  async getBatchMasterStats(@Query('masterIds') masterIds: string) {
    const ids = masterIds.split(',').filter((id) => id.trim());
    return this.service.getMastersBatchStats(ids);
  }
}
