import {
  Controller,
  Post,
  Body,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
  BadRequestException,
  HttpCode,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiResponse, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { UploadService } from './upload.service';
import { UploadFileDto } from './dto/upload-file.dto';
import { UploadResponseDto, BatchUploadResponseDto } from './dto/upload-response.dto';
import { User } from '@app/authorization';

interface JwtPayload {
  userId: string;
  email: string;
  roles: string[];
}

@ApiTags('Upload')
@ApiBearerAuth()
@ApiSecurity('cookie')
@Controller('files')
export class UploadController {
  constructor(private readonly uploadService: UploadService) { }

  @Post('upload')
  @HttpCode(200)
  @ApiOperation({ summary: 'Upload a single file' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
        contextId: {
          type: 'string',
          description: 'File context ID (validated against database)',
          example: 'product-image',
        },
        isPublic: {
          type: 'boolean',
          description: 'Whether the file should be publicly accessible (optional)',
          example: false,
        },
        metadata: {
          type: 'object',
          description: 'Optional metadata',
        },
      },
      required: ['file', 'contextId'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'File uploaded successfully',
    type: UploadResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadFileDto,
    @User() user: JwtPayload,
  ): Promise<UploadResponseDto> {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    if (dto.isPublic !== undefined && typeof dto.isPublic === 'string') {
      dto.isPublic = dto.isPublic === 'true';
    }

    return this.uploadService.uploadFile(file, dto, user.userId);
  }

  @Post('batch-upload')
  @HttpCode(200)
  @ApiOperation({ summary: 'Upload multiple files' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary',
          },
        },
        contextId: {
          type: 'string',
          description: 'File context ID (validated against database)',
          example: 'product-image',
        },
        isPublic: {
          type: 'boolean',
          description: 'Whether the files should be publicly accessible (optional)',
          example: false,
        },
        metadata: {
          type: 'object',
          description: 'Optional metadata',
        },
      },
      required: ['files', 'contextId'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Files uploaded successfully',
    type: BatchUploadResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @UseInterceptors(FilesInterceptor('files'))
  async batchUploadFiles(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() dto: UploadFileDto,
    @User() user: JwtPayload,
  ): Promise<BatchUploadResponseDto> {
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one file is required');
    }

    if (dto.isPublic !== undefined && typeof dto.isPublic === 'string') {
      dto.isPublic = dto.isPublic === 'true';
    }

    return this.uploadService.batchUploadFiles(files, dto, user.userId);
  }
}
