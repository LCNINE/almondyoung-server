import {
  Controller,
  Post,
  Body,
  BadRequestException,
  UseInterceptors,
  ValidationPipe,
  UsePipes,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiResponse, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { UploadService } from './upload.service';
import { UploadFileDto } from './dto/upload-file.dto';
import { UploadResponseDto, BatchUploadResponseDto } from './dto/upload-response.dto';
import { User } from '@app/authorization';
import { FileTransformInterceptor } from './file-transform.interceptor'; // VAP-FIX: Gemini's fix
import { MultipartFile } from '@fastify/multipart';

interface JwtPayload {
  userId: string;
  email: string;
  roles: string[];
}

@ApiTags('Upload')
@ApiBearerAuth()
@ApiSecurity('cookie')
@Controller('api/v1/files')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  /**
   * 단일 파일 업로드
   */
  @Post('upload')
  @ApiOperation({ summary: 'Upload a single file' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        context: {
          type: 'string',
          enum: [
            'product-image',
            'product-document',
            'user-avatar',
            'user-document',
            'invoice',
            'receipt',
            'shipment-label',
          ],
        },
        metadata: { type: 'object', description: 'Optional metadata' },
      },
      required: ['file', 'context'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'File uploaded successfully',
    type: UploadResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  // VAP-FIX: Gemini's fix - Apply the interceptor and standard validation pipe.
  @UseInterceptors(FileTransformInterceptor)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async uploadFile(
    @Body() dto: UploadFileDto,
    @User() user: JwtPayload,
  ): Promise<UploadResponseDto> {
    const file = dto.files?.[0] as MultipartFile;
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const result = await this.uploadService.uploadFile(file, dto, user.userId);
    return result;
  }

  /**
   * 다중 파일 업로드
   */
  @Post('batch-upload')
  @ApiOperation({ summary: 'Upload multiple files' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
        context: {
          type: 'string',
          enum: [
            'product-image',
            'product-document',
            'user-avatar',
            'user-document',
            'invoice',
            'receipt',
            'shipment-label',
          ],
        },
        metadata: { type: 'object', description: 'Optional metadata' },
      },
      required: ['files', 'context'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Files uploaded successfully',
    type: BatchUploadResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  // VAP-FIX: Gemini's fix - Apply the interceptor and standard validation pipe.
  @UseInterceptors(FileTransformInterceptor)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async batchUploadFiles(
    @Body() dto: UploadFileDto,
    @User() user: JwtPayload,
  ): Promise<BatchUploadResponseDto> {
    const files = dto.files as MultipartFile[];
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one file is required');
    }

    const result = await this.uploadService.batchUploadFiles(files, dto, user.userId);
    return result;
  }
}
