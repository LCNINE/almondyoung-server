import { Controller, Get, Logger, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { User } from '@app/authorization';
import { ProductVersionsService } from '../services/product-versions.service';
import { ApiOkResponsePaginated } from '../../../common/decorators';
import { ProductVersionDto } from '../dto/entities/master-version.entity';
import { PaginationQueryDto, PaginatedResponseDto } from '../../../common/dto';
import { DateMapper } from '../../../common/mappers';
import { ListMyDraftsQueryDto, MyDraftListItemDto } from '../dto/my-drafts.dto';

@ApiTags('Product Versions Without Master')
@Controller('versions')
export class ProductVersionsController {
  private readonly logger = new Logger(ProductVersionsController.name);

  constructor(private readonly productVersionsService: ProductVersionsService) {}

  @Get('draft')
  @ApiOperation({
    summary: 'Draft 버전 조회',
    description: 'Draft 버전 목록을 조회합니다.',
  })
  @ApiOkResponsePaginated(ProductVersionDto, {
    description: 'Draft 버전 목록 조회 성공',
  })
  async getDraftVersions(@Query() query: PaginationQueryDto) {
    this.logger.log(`getDraftVersions: ${JSON.stringify(query)}`);
    return this.productVersionsService.getDraftVersions(query);
  }

  @Get('my-drafts')
  @ApiOperation({
    summary: '내 작성중(임시저장) 상품 목록',
    description: '현재 로그인 사용자가 소유한 draft 버전 목록을 조회합니다.',
  })
  @ApiOkResponsePaginated(MyDraftListItemDto, {
    description: '내 draft 목록 조회 성공',
  })
  async getMyDrafts(
    @User() user: { userId: string },
    @Query() query: ListMyDraftsQueryDto,
  ): Promise<PaginatedResponseDto<MyDraftListItemDto>> {
    const result = await this.productVersionsService.getMyDraftVersions(user.userId, {
      page: query.page,
      limit: query.limit,
      q: query.q?.trim() || undefined,
      sort: query.sort,
      order: query.order,
    });

    return {
      data: result.data.map((row) => ({
        masterId: row.masterId,
        versionId: row.versionId,
        name: row.name,
        thumbnail: row.thumbnail,
        brand: row.brand,
        productType: row.productType,
        status: 'draft' as const,
        createdAt: DateMapper.toNotNullString(row.createdAt),
        updatedAt: DateMapper.toNotNullString(row.updatedAt),
      })),
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  }
}
