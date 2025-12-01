import { Controller, Post, Body, BadRequestException, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiResponse, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { UploadService } from './upload.service';
import { UploadFileDto } from './dto/upload-file.dto';
import { UploadResponseDto, BatchUploadResponseDto } from './dto/upload-response.dto';
import { User } from '@app/authorization';
import { FastifyRequest } from 'fastify';
import { MultipartFile } from '@fastify/multipart'; // 필요한 타입 임포트

// 전역 ValidationPipe를 사용하지 않는 경우, 여기서 직접 적용할 수도 있습니다.
// @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))

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
  async uploadFile(
    @Req() request: FastifyRequest,
    @Body() dto: UploadFileDto, // ValidationPipe가 request.body를 검증하고 DTO를 제공
    @User() user: JwtPayload,
  ): Promise<UploadResponseDto> {
    // 💡 1. 텍스트 필드는 @Body()와 ValidationPipe를 통해 검증된 dto 객체에서 바로 사용합니다.
    const bodyDto: UploadFileDto = dto;

    // 2. 파일 파트 추출
    // Fastify Part 객체를 가져와 MultipartFile 타입으로 명시
    const part = (await request.file()) as MultipartFile | undefined;

    if (!part) {
      throw new BadRequestException('File is required');
    }

    // 3. metadata는 fastify-multipart가 문자열로 파싱하여 request.body에 넣었을 가능성이 높습니다.
    // ValidationPipe가 string -> object 변환을 해주지 않았다면 여기서 수동 파싱합니다.
    if (bodyDto.metadata && typeof bodyDto.metadata === 'string') {
      try {
        bodyDto.metadata = JSON.parse(bodyDto.metadata);
      } catch (e) {
        throw new BadRequestException('Invalid metadata format. Must be a valid JSON string.');
      }
    }

    // 4. 서비스 호출 (Part 객체와 검증된 DTO 전달)
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
  async batchUploadFiles(
    @Req() request: FastifyRequest,
    @Body() dto: UploadFileDto, // ValidationPipe가 검증한 DTO
    @User() user: JwtPayload,
  ): Promise<BatchUploadResponseDto> {
    // 💡 1. 텍스트 필드는 @Body()를 통해 검증된 dto 객체에서 바로 사용
    const bodyDto: UploadFileDto = dto;

    // 2. 파일 파트 추출 (AsyncIterator)
    const files = request.files();

    // 3. metadata 수동 파싱 (필요 시)
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
