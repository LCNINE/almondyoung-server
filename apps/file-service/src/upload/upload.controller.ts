import {
  Controller,
  Post,
  Body,
  BadRequestException,
  Req,
  UsePipes, // 💡 UsePipes 임포트
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiResponse, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { UploadService } from './upload.service';
import { UploadFileDto } from './dto/upload-file.dto';
import { UploadResponseDto, BatchUploadResponseDto } from './dto/upload-response.dto';
import { User } from '@app/authorization';
import { FastifyRequest } from 'fastify';
import { MultipartFile } from '@fastify/multipart'; // 필요한 타입 임포트

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
  @UsePipes() // 🚨 핵심 수정: 글로벌 ValidationPipe 적용을 중지합니다. (RangeError 방지)
  async uploadFile(
    @Req() request: FastifyRequest,
    @Body() dto: UploadFileDto,
    @User() user: JwtPayload,
  ): Promise<UploadResponseDto> {
    // 💡 1. @Body()는 ValidationPipe를 통과하지 않으므로, request.body를 DTO 타입으로 간주하고 사용합니다.
    const bodyDto: UploadFileDto = request.body as any; // 타입 단언 (context, metadata 포함)

    // 2. 파일 파트 추출
    const part = (await request.file()) as MultipartFile | undefined;

    if (!part) {
      throw new BadRequestException('File is required');
    }

    // 3. metadata 수동 파싱 및 context 검증 (RangeError 방지를 위해 수동 검증 필수)
    if (!bodyDto.context) {
      // ValidationPipe가 없으므로 context 누락을 수동으로 확인
      throw new BadRequestException('Context field is required.');
    }

    if (bodyDto.metadata && typeof bodyDto.metadata === 'string') {
      try {
        bodyDto.metadata = JSON.parse(bodyDto.metadata);
      } catch (e) {
        throw new BadRequestException('Invalid metadata format. Must be a valid JSON string.');
      }
    }

    // 4. 서비스 호출 (Part 객체와 처리된 DTO 전달)
    const result = await this.uploadService.uploadFile(part, bodyDto, user.userId);

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
  @UsePipes() // 🚨 핵심 수정: 글로벌 ValidationPipe 적용을 중지합니다. (RangeError 방지)
  async batchUploadFiles(
    @Req() request: FastifyRequest,
    @Body() dto: UploadFileDto,
    @User() user: JwtPayload,
  ): Promise<BatchUploadResponseDto> {
    // 💡 1. @Body()는 ValidationPipe를 통과하지 않으므로, request.body를 DTO 타입으로 간주하고 사용합니다.
    const bodyDto: UploadFileDto = request.body as any;

    // 2. 파일 파트 추출 (AsyncIterator)
    const files = request.files();

    // 3. metadata 수동 파싱 및 context 검증
    if (!bodyDto.context) {
      throw new BadRequestException('Context field is required.');
    }

    if (bodyDto.metadata && typeof bodyDto.metadata === 'string') {
      try {
        bodyDto.metadata = JSON.parse(bodyDto.metadata);
      } catch (e) {
        throw new BadRequestException('Invalid metadata format. Must be a valid JSON string.');
      }
    }

    // 4. 서비스 호출 (Iterator와 검증된 DTO 전달)
    const result = await this.uploadService.batchUploadFiles(files, bodyDto, user.userId);

    return result;
  }
}
