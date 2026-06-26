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
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { ServerResponse } from 'http';
import { Readable } from 'stream';

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
    summary: '본인 ownership 의 현재 파일 버전을 binary stream 으로 다운로드 (exercise 필수)',
  })
  @ApiResponse({ status: 200, description: 'Binary stream + Content-Disposition' })
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
    @Res() res: Response,
  ): Promise<void> {
    const customerId = this._requireUserId(req);
    const { fileId, assetName, assetMimeType } = await this.service.getDownloadable(
      id,
      customerId,
    );

    const [{ stream, contentType, contentLength }, meta] = await Promise.all([
      this.fileServiceClient.fetchFile(fileId),
      this.fileServiceClient.fetchMetadata(fileId).catch(() => null),
    ]);

    // 파일명 결정: file-service 의 originalName > assetName.
    // 확장자 보존을 위해 originalName 을 우선.
    const downloadName = (meta?.originalName ?? meta?.fileName ?? assetName) || 'download';

    // Core 는 Fastify 어댑터다. Fastify reply 에 직접 pipe 하면 응답을 객체로 인식해
    // FST_ERR_REP_INVALID_PAYLOAD_TYPE("invalid type 'object'") 가 난다.
    // hijack() 으로 raw Node 응답을 take over 한 뒤 그쪽으로 스트리밍한다.
    const reply = res as unknown as { hijack: () => void; raw: ServerResponse };
    reply.hijack();
    reply.raw.setHeader('Content-Type', assetMimeType ?? meta?.mimeType ?? contentType);
    if (contentLength !== null && Number.isFinite(contentLength)) {
      reply.raw.setHeader('Content-Length', String(contentLength));
    }
    reply.raw.setHeader('Content-Disposition', buildContentDisposition(downloadName));

    // Web ReadableStream → Node Readable, then pipe to raw response
    const nodeStream = Readable.fromWeb(stream as any);
    nodeStream.on('error', () => reply.raw.destroy());
    nodeStream.pipe(reply.raw);
  }

  private _requireUserId(req: any): string {
    const userId: string | undefined = req?.user?.userId ?? req?.user?.sub;
    if (!userId) {
      throw new UnauthorizedException('Authenticated user required');
    }
    return userId;
  }
}

/**
 * RFC 5987 형식의 Content-Disposition 헤더를 만든다.
 * 한국어/유니코드 파일명을 안전하게 전달하기 위해 ASCII fallback + `filename*=UTF-8''...` 사용.
 */
function buildContentDisposition(filename: string): string {
  const asciiFallback = filename.replace(/[^\x20-\x7E]+/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/['()]/g, escape);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
