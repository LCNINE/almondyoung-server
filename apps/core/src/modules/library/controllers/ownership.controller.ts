import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { OwnershipFilter, OwnershipService } from '../services/ownership.service';
import { FileServiceClient } from '../clients/file-service.client';
import {
  OwnershipListResponseDto,
  OwnershipResponseDto,
} from '../dto/ownership-response.dto';

const ALLOWED_FILTERS: OwnershipFilter[] = ['all', 'new', 'used'];

@ApiTags('Library / Ownerships')
@Controller('library/ownerships')
export class OwnershipController {
  constructor(
    private readonly service: OwnershipService,
    private readonly fileServiceClient: FileServiceClient,
  ) {}

  @Get()
  @ApiOperation({ summary: '본인 ownership 목록 (revoke 된 항목 제외)' })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiQuery({ name: 'filter', required: false, enum: ALLOWED_FILTERS })
  @ApiResponse({ status: 200, type: OwnershipListResponseDto })
  async list(
    @Req() req: any,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('filter') filter?: string,
  ): Promise<OwnershipListResponseDto> {
    const customerId = this._requireUserId(req);

    let filterValue: OwnershipFilter | undefined;
    if (filter !== undefined) {
      if (!ALLOWED_FILTERS.includes(filter as OwnershipFilter)) {
        throw new BadRequestException(`filter must be one of ${ALLOWED_FILTERS.join(', ')}`);
      }
      filterValue = filter as OwnershipFilter;
    }

    return this.service.listForCustomer(customerId, {
      skip: skip !== undefined ? Number(skip) : undefined,
      take: take !== undefined ? Number(take) : undefined,
      filter: filterValue,
    });
  }

  @Post(':id/exercise')
  @HttpCode(200)
  @ApiOperation({
    summary: '본인 ownership 사용 처리 (idempotent — 이미 exercise 된 경우 그대로 성공)',
  })
  @ApiResponse({ status: 200, type: OwnershipResponseDto })
  async exercise(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
  ): Promise<OwnershipResponseDto> {
    const customerId = this._requireUserId(req);
    return this.service.exercise(id, customerId);
  }

  @Get(':id/download')
  @ApiOperation({
    summary: '본인 ownership 의 현재 파일 다운로드 signed URL 반환 (exercise 필수)',
  })
  @ApiResponse({
    status: 200,
    description: '{ url, filename } — 브라우저가 S3 signed URL 에서 직접 다운로드(강제 다운로드 disposition 포함)',
  })
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
  ): Promise<{ url: string; filename: string }> {
    const customerId = this._requireUserId(req);
    const { fileId, assetName } = await this.service.getDownloadable(id, customerId);

    // 파일 바이트를 Core/스토어프론트로 프록시하지 않는다. file-service 의 강제 다운로드 signed URL 을
    // 받아 반환하면 브라우저가 S3 에서 직접 받는다 (대용량 파일 Lambda 6MB 응답한도 502 회피).
    // 반환 filename 은 실제 S3 다운로드 파일명(file-service originalName)과 일치시킨다.
    const [meta, url] = await Promise.all([
      this.fileServiceClient.fetchMetadata(fileId).catch(() => null),
      this.fileServiceClient.getDownloadUrl(fileId),
    ]);
    const filename = meta?.originalName ?? meta?.fileName ?? assetName;
    return { url, filename };
  }

  private _requireUserId(req: any): string {
    const userId: string | undefined = req?.user?.userId ?? req?.user?.sub;
    if (!userId) {
      throw new UnauthorizedException('Authenticated user required');
    }
    return userId;
  }
}
