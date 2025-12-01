import {
  Controller,
  Post,
  Body,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiResponse, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { UploadService } from './upload.service';
import { UploadFileDto } from './dto/upload-file.dto';
import { UploadResponseDto, BatchUploadResponseDto } from './dto/upload-response.dto';
import { User } from '@app/authorization';
import { FastifyRequest } from 'fastify';
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

  @Post('upload')
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
        metadata: {
          type: 'object',
          description: 'Optional metadata',
        },
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
  async uploadFile(
    @Req() request: FastifyRequest, // 요청 객체에서 파일을 직접 처리하기 위해 FastifyRequest 사용
    @Body() dto: UploadFileDto, // 나머지 폼 데이터는 DTO로 받거나 직접 파싱
    @User() user: JwtPayload,
  ): Promise<UploadResponseDto> {
    // Fastify Part 객체를 가져와 처리하는 로직을 직접 구현해야 합니다.
    // 이 로직은 FileInterceptor가 하던 역할을 대신합니다.
    const part = await request.file(); // fastifyMultipart 플러그인이 제공하는 메서드

    if (!part) {
      throw new BadRequestException('File is required');
    }

    // 예시: Part 객체에서 파일 정보를 읽고 업로드 서비스 호출
    // part.filename, part.mimetype, part.file (스트림) 등을 사용
    const result = await this.uploadService.uploadFile(part, dto, user.userId);

    return result;
  }
  @Post('batch-upload')
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
        metadata: {
          type: 'object',
          description: 'Optional metadata',
        },
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
  async batchUploadFiles(
    @Req() request: FastifyRequest,
    @Body() dto: UploadFileDto,
    @User() user: JwtPayload,
  ): Promise<BatchUploadResponseDto> {
    const files = await request.files();

    return this.uploadService.batchUploadFiles(files, dto, user.userId);
  }
}
