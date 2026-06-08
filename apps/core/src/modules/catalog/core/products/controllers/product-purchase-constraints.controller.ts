import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PurchaseConstraintResponseDto, UpsertPurchaseConstraintDto } from '../dto/purchase-constraints';
import { PurchaseConstraintMapper } from '../mappers/purchase-constraint.mapper';
import { ProductPurchaseConstraintsService } from '../services/product-purchase-constraints.service';

@ApiTags('Product Purchase Constraints')
@Controller('masters/:masterId/versions/:versionId/purchase-constraint')
export class ProductPurchaseConstraintsController {
  constructor(private readonly purchaseConstraintsService: ProductPurchaseConstraintsService) {}

  @Get()
  @ApiOperation({
    summary: '상품 버전 구매 제한 조회',
    description: '특정 상품 마스터 버전에 매핑된 구매 제한을 조회합니다.',
  })
  @ApiParam({ name: 'masterId', description: 'Master ID' })
  @ApiParam({ name: 'versionId', description: 'Version ID' })
  @ApiResponse({
    status: 200,
    description: '구매 제한 조회 성공',
    type: PurchaseConstraintResponseDto,
  })
  @ApiResponse({ status: 404, description: '버전을 찾을 수 없음' })
  async getPurchaseConstraint(
    @Param('masterId') masterId: string,
    @Param('versionId') versionId: string,
  ): Promise<PurchaseConstraintResponseDto | null> {
    const model = await this.purchaseConstraintsService.getForVersion(masterId, versionId);
    return model ? PurchaseConstraintMapper.toResponseDto(model) : null;
  }

  @Put()
  @ApiOperation({
    summary: 'Draft 버전 구매 제한 저장',
    description: 'Draft 버전의 구매 제한을 생성하거나 수정합니다. 제한이 없는 입력은 매핑을 삭제합니다.',
  })
  @ApiParam({ name: 'masterId', description: 'Master ID' })
  @ApiParam({ name: 'versionId', description: 'Version ID (draft)' })
  @ApiBody({ type: UpsertPurchaseConstraintDto })
  @ApiResponse({
    status: 200,
    description: '구매 제한 저장 성공',
    type: PurchaseConstraintResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Draft가 아닌 버전이거나 잘못된 요청 데이터' })
  @ApiResponse({ status: 404, description: '버전을 찾을 수 없음' })
  async upsertPurchaseConstraint(
    @Param('masterId') masterId: string,
    @Param('versionId') versionId: string,
    @Body() body: UpsertPurchaseConstraintDto,
  ): Promise<PurchaseConstraintResponseDto | null> {
    const model = await this.purchaseConstraintsService.upsertForDraft(masterId, versionId, {
      ...body,
      lifetimeQuantityLimit: body.lifetimeQuantityLimit ?? null,
    });

    return model ? PurchaseConstraintMapper.toResponseDto(model) : null;
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Draft 버전 구매 제한 삭제',
    description: 'Draft 버전에 매핑된 구매 제한을 삭제합니다. 고아 constraint row는 함께 정리됩니다.',
  })
  @ApiParam({ name: 'masterId', description: 'Master ID' })
  @ApiParam({ name: 'versionId', description: 'Version ID (draft)' })
  @ApiResponse({ status: 204, description: '구매 제한 삭제 성공' })
  @ApiResponse({ status: 400, description: 'Draft가 아닌 버전' })
  @ApiResponse({ status: 404, description: '버전을 찾을 수 없음' })
  async deletePurchaseConstraint(
    @Param('masterId') masterId: string,
    @Param('versionId') versionId: string,
  ): Promise<void> {
    await this.purchaseConstraintsService.deleteForDraft(masterId, versionId);
  }
}
