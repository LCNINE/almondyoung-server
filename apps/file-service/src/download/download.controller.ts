import { Controller, Get, Param, Query, ParseUUIDPipe, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { DownloadService } from './download.service';
import { SignedUrlResponseDto } from './dto/signed-url-response.dto';
import { FileMetadataResponseDto } from './dto/file-metadata-response.dto';

@ApiTags('Download')
@Controller('api/v1/files')
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
  @ApiResponse({ status: 400, description: 'File is not active' })
  async getSignedUrl(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Query('expiresIn', new DefaultValuePipe(3600), ParseIntPipe) expiresIn: number,
  ): Promise<SignedUrlResponseDto> {
    return this.downloadService.getSignedUrl(fileId, expiresIn);
  }

  @Get(':fileId/metadata')
  @ApiOperation({ summary: 'Get file metadata' })
  @ApiParam({ name: 'fileId', description: 'File ID', type: 'string' })
  @ApiResponse({ status: 200, description: 'File metadata', type: FileMetadataResponseDto })
  @ApiResponse({ status: 404, description: 'File not found' })
  async getMetadata(
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<FileMetadataResponseDto> {
    return this.downloadService.getMetadata(fileId);
  }
}

