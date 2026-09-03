import {
  Controller,
  Get,
  Head,
  Param,
  Query,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { Public, User } from '@app/authorization';
import { Response } from 'express';
import { DownloadService } from './download.service';
import { SignedUrlResponseDto } from './dto/signed-url-response.dto';
import { FileMetadataResponseDto } from './dto/file-metadata-response.dto';
import { JwtPayload } from '../shared/types/jwt-payload.interface';

/**
 * /open 링크가 돌려주는 서명 URL 의 수명. 링크를 누른 뒤 실제로 내려받기 시작할 때까지의
 * 시간만 버티면 되므로 짧게 둔다 — 리다이렉트된 URL 은 브라우저 히스토리에 남는다.
 */
const OPEN_LINK_EXPIRES_IN_SECONDS = 300;

@ApiTags('Download')
@ApiBearerAuth()
@ApiSecurity('cookie')
@Controller('files')
export class DownloadController {
  constructor(private readonly downloadService: DownloadService) {}

  @Get(':fileId/download')
  @ApiOperation({ summary: 'Get signed URL for file download' })
  @ApiParam({ name: 'fileId', description: 'File ID', type: 'string' })
  @ApiQuery({
    name: 'expiresIn',
    description: 'Expiration time in seconds',
    required: false,
    type: 'number',
    example: 3600,
  })
  @ApiResponse({ status: 200, description: 'Signed URL generated', type: SignedUrlResponseDto })
  @ApiResponse({ status: 404, description: 'File not found' })
  @ApiResponse({ status: 403, description: 'Not authorized to access this file' })
  async getSignedUrl(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Query('expiresIn', new DefaultValuePipe(3600), ParseIntPipe) expiresIn: number,
    @User() user: JwtPayload,
    @Query('download') download?: string,
  ): Promise<SignedUrlResponseDto> {
    return this.downloadService.getSignedUrl(fileId, expiresIn, user, download === 'true' || download === '1');
  }

  /**
   * 비공개 파일을 «평범한 링크»로 열 수 있게 하는 경로.
   *
   * :fileId/download 는 JSON 을 돌려주므로 열려면 자바스크립트가 필요하다. 그런데 문서
   * 본문(리치 텍스트)에 들어가는 것은 앵커 하나뿐이라, 첨부를 비공개로 두려면 서명 URL 로
   * 302 해 주는 경로가 있어야 한다. 권한 검사는 download 와 같은 loadReadable 을 탄다.
   */
  @Get(':fileId/open')
  @ApiOperation({ summary: 'Redirect to a signed URL so a plain link can open a private file' })
  @ApiParam({ name: 'fileId', description: 'File ID', type: 'string' })
  @ApiQuery({ name: 'download', description: '강제 다운로드 여부', required: false })
  @ApiResponse({ status: 302, description: 'Redirects to the signed URL' })
  @ApiResponse({ status: 403, description: 'Not authorized to access this file' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async openFile(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @User() user: JwtPayload,
    @Res() res: Response,
    @Query('download') download?: string,
  ) {
    const { signedUrl } = await this.downloadService.getSignedUrl(
      fileId,
      OPEN_LINK_EXPIRES_IN_SECONDS,
      user,
      download === 'true' || download === '1',
    );
    return res.redirect(302, signedUrl);
  }

  @Get(':fileId/metadata')
  @ApiOperation({ summary: 'Get file metadata' })
  @ApiParam({ name: 'fileId', description: 'File ID', type: 'string' })
  @ApiResponse({ status: 200, description: 'File metadata', type: FileMetadataResponseDto })
  @ApiResponse({ status: 404, description: 'File not found' })
  @ApiResponse({ status: 403, description: 'Not authorized to access this file' })
  async getMetadata(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @User() user: JwtPayload,
  ): Promise<FileMetadataResponseDto> {
    return this.downloadService.getMetadata(fileId, user);
  }

  @Get('public/:fileId')
  @Public()
  @ApiOperation({
    summary: 'Serve public file directly by ID',
    description: 'Returns public file URL without authentication. Use in <img src="..." /> directly.',
  })
  @ApiParam({ name: 'fileId', description: 'File UUID' })
  @ApiResponse({ status: 302, description: 'Redirects to S3 public URL' })
  @ApiResponse({ status: 404, description: 'File not found or not public' })
  async servePublicFile(@Param('fileId', ParseUUIDPipe) fileId: string, @Res() res: Response) {
    try {
      const url = await this.downloadService.resolvePublicUrl(fileId);
      return res.redirect(302, url);
    } catch (err) {
      // 로컬 개발 편의: 이 인스턴스에 없는 파일은 상위 file-service 로 넘긴다.
      // 로컬 업로드본과 라이브 시드 이미지를 한 base URL 로 같이 볼 수 있게 하는 용도.
      // PUBLIC_FILE_FALLBACK_BASE_URL 이 없으면 기존대로 404.
      const fallback = process.env.PUBLIC_FILE_FALLBACK_BASE_URL;
      if (!fallback) throw err;
      return res.redirect(302, `${fallback.replace(/\/+$/, '')}/files/public/${fileId}`);
    }
  }

  @Head('public/:fileId')
  @Public()
  @ApiOperation({ summary: 'Check if public file exists' })
  @ApiParam({ name: 'fileId', description: 'File UUID' })
  @ApiResponse({ status: 200, description: 'File exists and is public' })
  @ApiResponse({ status: 404, description: 'File not found or not public' })
  async checkPublicFile(@Param('fileId', ParseUUIDPipe) fileId: string) {
    await this.downloadService.resolvePublicUrl(fileId);
    return { exists: true };
  }
}
