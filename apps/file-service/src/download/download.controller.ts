import { Controller, Get, Head, Param, Query, ParseUUIDPipe, ParseIntPipe, DefaultValuePipe, Res, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { RequireScopes, Public, User } from '@app/authorization';
import { JwtPayload } from '../shared/types/jwt-payload.interface';
import { Response } from 'express';
import { DownloadService } from './download.service';
import { SignedUrlResponseDto } from './dto/signed-url-response.dto';
import { FileMetadataResponseDto } from './dto/file-metadata-response.dto';
import { FileRepository } from '../shared/repositories/file.repository';

@ApiTags('Download')
@ApiBearerAuth()
@ApiSecurity('cookie')
@Controller('files')
export class DownloadController {
  constructor(
    private readonly downloadService: DownloadService,
    private readonly fileRepository: FileRepository,
  ) { }

  @Get(':fileId/download')
  // @RequireScopes('file:read')
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
  @ApiResponse({ status: 400, description: 'File is not active' })
  @ApiResponse({ status: 403, description: 'Not authorized to access this file' })
  async getSignedUrl(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Query('expiresIn', new DefaultValuePipe(3600), ParseIntPipe) expiresIn: number,
    @User() user: JwtPayload,
  ): Promise<SignedUrlResponseDto> {
    return this.downloadService.getSignedUrl(fileId, expiresIn, user);
  }

  @Get(':fileId/metadata')
  // @RequireScopes('file:read')
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
  @ApiResponse({ status: 403, description: 'File is not public' })
  @ApiResponse({ status: 404, description: 'File not found or inactive' })
  async servePublicFile(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Res() res: Response,
  ) {
    const file = await this.fileRepository.findById(fileId);

    if (!file) {
      throw new NotFoundException('File not found');
    }

    if (!file.isPublic) {
      throw new ForbiddenException('File is not public');
    }

    if (file.status !== 'active') {
      throw new NotFoundException('File not available');
    }

    return res.redirect(302, file.url);
  }

  @Head('public/:fileId')
  @Public()
  @ApiOperation({ summary: 'Check if public file exists' })
  @ApiParam({ name: 'fileId', description: 'File UUID' })
  @ApiResponse({ status: 200, description: 'File exists and is public' })
  @ApiResponse({ status: 404, description: 'File not found, not public, or inactive' })
  async checkPublicFile(@Param('fileId', ParseUUIDPipe) fileId: string) {
    const file = await this.fileRepository.findById(fileId);

    if (!file || !file.isPublic || file.status !== 'active') {
      throw new NotFoundException();
    }

    return { exists: true };
  }
}

