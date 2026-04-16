import { Controller, Get, Logger, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ProductVersionsService } from '../services/product-versions.service';
import { ApiOkResponsePaginated } from '../../../common/decorators';
import { ProductVersionDto } from '../dto/entities/master-version.entity';
import { PaginationQueryDto } from '../../../common/dto';

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
}
