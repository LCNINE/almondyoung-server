import {
  Controller,
  Post,
  Body,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
  UsePipes,
  BadRequestException,
  HttpCode,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiResponse, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { UploadService } from './upload.service';
import { UploadFileDto } from './dto/upload-file.dto';
import { UploadResponseDto, BatchUploadResponseDto } from './dto/upload-response.dto';
import { PresignUploadDto, PresignUploadResponseDto, ConfirmUploadDto } from './dto/presign-upload.dto';
import { UPLOAD_MULTER_OPTIONS } from './multer-options';
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
  constructor(private readonly uploadService: UploadService) {}

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
  @UseInterceptors(FileInterceptor('file', UPLOAD_MULTER_OPTIONS))
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

  @Post('upload/presign')
  @HttpCode(200)
  // 이 서비스는 전역 ValidationPipe 가 없다 — JSON body 라우트는 여기서 직접 건다
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'Issue a presigned PUT URL for direct-to-storage upload' })
  @ApiResponse({ status: 200, description: 'Presigned URL issued', type: PresignUploadResponseDto })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Direct upload not supported or context not found' })
  async presignUpload(@Body() dto: PresignUploadDto, @User() user: JwtPayload): Promise<PresignUploadResponseDto> {
    return this.uploadService.presignUpload(dto, user.userId);
  }

  @Post('upload/confirm')
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'Confirm a direct upload and activate the file' })
  @ApiResponse({ status: 200, description: 'File activated', type: UploadResponseDto })
  @ApiResponse({ status: 400, description: 'Object missing or exceeds context limit' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async confirmUpload(@Body() dto: ConfirmUploadDto, @User() user: JwtPayload): Promise<UploadResponseDto> {
    return this.uploadService.confirmUpload(dto.fileId, user.userId);
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
  @UseInterceptors(FilesInterceptor('files', undefined, UPLOAD_MULTER_OPTIONS))
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
