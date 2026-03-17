import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';
import { ProductVersionsService } from '../services/product-versions.service';
import { ProductMastersService } from '../services/product-masters.service';
import {
  CreateDraftVersionDto,
  VersionTreeResponseDto,
  VersionDiffItemDto,
} from '../dto/versions';
import { UpdateProductMasterDto } from '../dto';
import { ProductVersionMapper } from '../mappers/product-version.mapper';

@ApiTags('Product Versions With Master')
@Controller('masters/:masterId/versions')
export class ProductMasterVersionsController {
  private readonly logger = new Logger(ProductMasterVersionsController.name);

  constructor(
    private readonly productVersionsService: ProductVersionsService,
    private readonly productMastersService: ProductMastersService,
  ) { }

  @Get()
  @ApiOperation({
    summary: '버전 트리 조회',
    description: '특정 Master ID에 대한 모든 버전을 트리 구조로 조회합니다.',
  })
  @ApiParam({ name: 'masterId', description: 'Master ID' })
  @ApiResponse({
    status: 200,
    description: '버전 트리 조회 성공',
    type: [VersionTreeResponseDto],
  })
  @ApiResponse({ status: 404, description: '버전을 찾을 수 없음' })
  async getVersionTree(
    @Param('masterId') masterId: string,
  ): Promise<VersionTreeResponseDto[]> {
    const tree = await this.productVersionsService.getVersionTree(masterId);
    return tree.map((node) => this._mapToResponseDto(node));
  }

  @Get('active')
  @ApiOperation({
    summary: 'Active 버전 조회',
    description: '특정 Master ID의 현재 active 상태인 버전을 조회합니다.',
  })
  @ApiParam({ name: 'masterId', description: 'Master ID' })
  @ApiResponse({
    status: 200,
    description: 'Active 버전 조회 성공',
  })
  @ApiResponse({ status: 404, description: 'Active 버전을 찾을 수 없음' })
  async getActiveVersion(@Param('masterId') masterId: string) {
    const version = await this.productVersionsService.getActiveVersion(masterId);
    return {
      ...version,
      createdAt: version.createdAt?.toISOString() || null,
      updatedAt: version.updatedAt?.toISOString() || null,
    };
  }

  @Get(':versionId')
  @ApiOperation({
    summary: '특정 버전 조회',
    description: 'Version ID로 특정 버전을 조회합니다. 모든 상태(draft, active, inactive)의 버전을 조회할 수 있습니다. 태그, 이미지, 옵션, 변형 정보를 포함합니다.',
  })
  @ApiParam({ name: 'masterId', description: 'Master ID' })
  @ApiParam({ name: 'versionId', description: 'Version ID' })
  @ApiResponse({
    status: 200,
    description: '버전 상세 조회 성공 (태그, 이미지, 옵션, 변형 포함)',
  })
  @ApiResponse({ status: 404, description: '버전을 찾을 수 없음' })
  async getVersionById(
    @Param('masterId') masterId: string,
    @Param('versionId') versionId: string,
  ) {
    const versionDetail = await this.productVersionsService.getVersionDetail(versionId);

    if (versionDetail.masterId !== masterId) {
      throw new HttpException(
        'Version does not belong to the specified master',
        HttpStatus.BAD_REQUEST,
      );
    }

    return ProductVersionMapper.toDetailResponseDto(versionDetail);
  }

  @Post()
  @ApiOperation({
    summary: '새 Draft 버전 생성',
    description: `기존 버전을 기반으로 새로운 draft 버전을 생성합니다.
    
    parentVersionId가 제공되지 않으면 현재 active 버전을 부모로 사용합니다.
    active 버전이 없는 경우 400 에러를 반환합니다.`,
  })
  @ApiParam({ name: 'masterId', description: 'Master ID' })
  @ApiResponse({
    status: 201,
    description: 'Draft 버전 생성 성공',
  })
  @ApiResponse({ status: 404, description: '부모 버전을 찾을 수 없음' })
  @ApiResponse({ status: 400, description: 'active 버전이 없거나 잘못된 요청' })
  async createDraftVersion(
    @Param('masterId') masterId: string,
    @Body() dto: CreateDraftVersionDto,
  ) {
    let parentVersionId = dto.parentVersionId;

    if (!parentVersionId) {
      try {
        const activeVersion = await this.productVersionsService.getActiveVersion(masterId);
        parentVersionId = activeVersion.id;
      } catch {
        throw new HttpException(
          'No active version found. Please provide parentVersionId explicitly.',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const userId = '00000000-0000-0000-0000-000000000000';
    const version = await this.productVersionsService.createDraftVersion(
      parentVersionId,
      userId,
      dto.copyMappings !== false,
    );
    return {
      ...version,
      createdAt: version.createdAt?.toISOString() || null,
      updatedAt: version.updatedAt?.toISOString() || null,
    };
  }

  @Put(':versionId')
  @ApiOperation({
    summary: 'Draft 버전 수정',
    description: 'Draft 상태의 버전을 수정합니다. Active 또는 Inactive 상태의 버전은 수정할 수 없습니다.',
  })
  @ApiParam({ name: 'masterId', description: 'Master ID' })
  @ApiParam({ name: 'versionId', description: 'Version ID (수정할 draft 버전)' })
  @ApiBody({
    type: UpdateProductMasterDto,
    description: '수정할 버전 정보',
  })
  @ApiResponse({
    status: 200,
    description: 'Draft 버전 수정 성공 (태그, 이미지 등 포함)',
  })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 403, description: 'Draft 상태의 버전만 수정 가능' })
  @ApiResponse({ status: 404, description: '버전을 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async updateVersion(
    @Param('masterId') masterId: string,
    @Param('versionId') versionId: string,
    @Body() updateData: UpdateProductMasterDto,
  ) {
    try {
      // TODO: JWT에서 실제 userId 추출
      const userId = '00000000-0000-0000-0000-000000000000';

      // 권한 확인 (draft 상태인지, 소유자인지)
      const canModify = await this.productVersionsService.canUserModifyVersion(
        versionId,
        userId,
      );

      if (!canModify) {
        throw new HttpException(
          'Only draft versions can be modified. Create a new draft version to make changes.',
          HttpStatus.FORBIDDEN,
        );
      }

      const updatedVersion = await this.productMastersService.updateVersion(
        versionId,
        updateData,
      );

      const versionDetail = await this.productVersionsService.getVersionDetail(updatedVersion.id);
      return ProductVersionMapper.toDetailResponseDto(versionDetail);
    } catch (error) {
      this.logger.error(`Failed to update version: ${error.message}`, error.stack);

      if (error.status === HttpStatus.FORBIDDEN) {
        throw error;
      }
      if (error.message.includes('not found')) {
        throw new HttpException('Version not found', HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('Only draft')) {
        throw new HttpException(error.message, HttpStatus.FORBIDDEN);
      }
      if (error.message.includes('required')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        `Failed to update version: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch(':versionId/publish')
  @ApiOperation({
    summary: '버전 Publish',
    description: 'Draft 또는 Inactive 버전을 Active 상태로 변경합니다. Inactive 버전을 활성화하면 이전 버전으로 롤백할 수 있습니다. 기존 Active 버전이 있으면 자동으로 Inactive로 전환됩니다.',
  })
  @ApiParam({ name: 'masterId', description: 'Master ID' })
  @ApiParam({ name: 'versionId', description: 'Version ID (Draft 또는 Inactive 상태여야 함)' })
  @ApiResponse({
    status: 200,
    description: '버전 publish 성공',
  })
  @ApiResponse({ status: 404, description: '버전을 찾을 수 없음' })
  @ApiResponse({ status: 400, description: 'Draft 또는 Inactive 상태가 아닌 버전은 publish할 수 없음' })
  async publishVersion(
    @Param('masterId') masterId: string,
    @Param('versionId') versionId: string,
  ) {
    try {
      await this.productVersionsService.publishVersion(versionId);
      return { message: 'Version published successfully' };
    } catch (error) {
      this.logger.error(`Failed to publish version: ${error.message}`, error.stack);
      if (error.message.includes('not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('Only draft or inactive')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        `Failed to publish version: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':versionId/compare/:compareVersionId')
  @ApiOperation({
    summary: '버전 비교',
    description: '두 버전 간의 차이점을 비교합니다.',
  })
  @ApiParam({ name: 'masterId', description: 'Master ID' })
  @ApiParam({ name: 'versionId', description: '비교 대상 버전 ID 1' })
  @ApiParam({ name: 'compareVersionId', description: '비교 대상 버전 ID 2' })
  @ApiResponse({
    status: 200,
    description: '버전 비교 성공',
    type: [VersionDiffItemDto],
  })
  @ApiResponse({ status: 404, description: '버전을 찾을 수 없음' })
  @ApiResponse({ status: 400, description: '다른 master의 버전은 비교할 수 없음' })
  async compareVersions(
    @Param('masterId') masterId: string,
    @Param('versionId') versionId: string,
    @Param('compareVersionId') compareVersionId: string,
  ): Promise<VersionDiffItemDto[]> {
    try {
      return await this.productVersionsService.compareVersions(versionId, compareVersionId);
    } catch (error) {
      this.logger.error(`Failed to compare versions: ${error.message}`, error.stack);
      if (error.message.includes('not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('Cannot compare')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        `Failed to compare versions: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(':versionId')
  @ApiOperation({
    summary: 'Draft 버전 삭제',
    description: 'Draft 상태의 버전을 삭제합니다. 오직 이 버전만 참조하던 variant도 함께 삭제됩니다.',
  })
  @ApiParam({ name: 'masterId', description: 'Master ID' })
  @ApiParam({ name: 'versionId', description: 'Version ID (삭제할 draft)' })
  @ApiResponse({ status: 200, description: 'Draft 버전 삭제 성공' })
  @ApiResponse({ status: 400, description: 'Draft가 아닌 버전은 삭제 불가' })
  @ApiResponse({ status: 404, description: '버전을 찾을 수 없음' })
  async deleteDraftVersion(
    @Param('masterId') masterId: string,
    @Param('versionId') versionId: string,
  ) {
    try {
      await this.productVersionsService.deleteDraftVersion(versionId);
      return {
        success: true,
        message: `Draft version ${versionId} deleted successfully`,
      };
    } catch (error) {
      this.logger.error(`Failed to delete draft version: ${error.message}`, error.stack);
      if (error.message.includes('not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      if (error.message.includes('Only draft')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        `Failed to delete draft version: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private _mapToResponseDto(node: any): VersionTreeResponseDto {
    return {
      id: node.id,
      masterId: node.masterId,
      version: node.version,
      status: node.status,
      name: node.name,
      parentVersionId: node.parentVersionId,
      children: node.children.map((child: any) => this._mapToResponseDto(child)),
      createdAt: node.createdAt?.toISOString() || node.createdAt,
      updatedAt: node.updatedAt?.toISOString() || node.updatedAt,
      draftOwnerId: node.draftOwnerId,
    };
  }
}

