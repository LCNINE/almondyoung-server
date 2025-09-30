import {
  Controller,
  Post,
  Req,
  BadRequestException,
  Body,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiBody,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { join } from 'path';
import { promises as fs } from 'fs';
import { uploads, productImages } from '../schema'; // uploads, productImages 테이블
import { v7 as uuidv7 } from 'uuid';
import { DbService } from '@app/db';
import { PimSchema } from '../schema';
import { eq, and } from 'drizzle-orm';

@ApiTags('파일 업로드')
@Controller('uploads')
export class FileUploadController {
  constructor(private readonly db: DbService<PimSchema>) {}

  @Post()
  @ApiOperation({ summary: '파일 업로드', description: '단일 파일 업로드' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: '업로드할 파일',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: 201,
    description: '파일 업로드 성공',
    schema: {
      type: 'object',
      properties: {
        uploadId: { type: 'string', description: '업로드 ID' },
        url: { type: 'string', description: '업로드된 파일 URL' },
      },
    },
  })
  async uploadFile(@Req() req: FastifyRequest) {
    // Fastify의 multipart API 사용
    const file: any = await (req as any).file(); // 타입 충돌 방지 위해 any
    if (!file) {
      throw new BadRequestException('파일이 업로드되지 않았습니다.');
    }

    const { filename, mimetype, file: stream } = file;
    // 파일을 버퍼로 읽기
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // 로컬에 저장
    const savedName = `${Date.now()}-${filename}`;
    const savePath = join(process.cwd(), 'apps', 'pim', 'images', savedName);

    // 디렉토리가 없으면 생성
    const imageDir = join(process.cwd(), 'apps', 'pim', 'images');
    await fs.mkdir(imageDir, { recursive: true });

    await fs.writeFile(savePath, buffer);

    // 정적 서빙된 URL
    const url = `/images/${savedName}`;

    // === DB INSERT 추가 (uploads 테이블) ===
    const [uploadRecord] = await this.db.db
      .insert(uploads)
      .values({
        id: uuidv7(),
        fileName: savedName,
        originalName: filename,
        mimeType: mimetype,
        filePath: savePath,
        url,
        size: buffer.length,
      })
      .returning();

    // 업로드 ID와 URL 반환
    return { uploadId: uploadRecord.id, url };
  }

  @Post('masters/:masterId/images')
  @ApiOperation({
    summary: '상품 마스터에 이미지 연결',
    description:
      '업로드된 파일을 상품 마스터에 연결합니다. 대표이미지와 부가이미지를 설정할 수 있습니다.',
  })
  @ApiParam({
    name: 'masterId',
    description: '상품 마스터 ID',
    type: 'string',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        images: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              uploadId: { type: 'string', description: '업로드 파일 ID' },
              isPrimary: {
                type: 'boolean',
                description: '대표이미지 여부',
                default: false,
              },
              sortOrder: {
                type: 'number',
                description: '이미지 순서 (1-5)',
                minimum: 0,
                maximum: 5,
              },
            },
            required: ['uploadId'],
          },
        },
      },
      required: ['images'],
    },
  })
  @ApiResponse({
    status: 201,
    description: '이미지 연결 성공',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        connectedImages: { type: 'number', description: '연결된 이미지 수' },
      },
    },
  })
  async connectImagesToMaster(
    @Param('masterId', ParseUUIDPipe) masterId: string,
    @Body()
    body: {
      images: Array<{
        uploadId: string;
        isPrimary?: boolean;
        sortOrder?: number;
      }>;
    },
  ) {
    const { images } = body;

    if (!images || images.length === 0) {
      throw new BadRequestException('연결할 이미지가 없습니다.');
    }

    // 대표이미지가 2개 이상인지 확인
    const primaryImages = images.filter((img) => img.isPrimary);
    if (primaryImages.length > 1) {
      throw new BadRequestException('대표이미지는 1개만 설정할 수 있습니다.');
    }

    // 트랜잭션으로 처리
    const result = await this.db.db.transaction(async (tx) => {
      // 기존 이미지 연결 삭제 (선택사항: 덮어쓰기 방식)
      await tx
        .delete(productImages)
        .where(eq(productImages.masterId, masterId));

      // 새로운 이미지 연결
      const imageRecords = images.map((img, index) => ({
        id: uuidv7(),
        masterId,
        uploadId: img.uploadId,
        isPrimary: img.isPrimary || false,
        sortOrder: img.sortOrder ?? (img.isPrimary ? 0 : index + 1),
      }));

      await tx.insert(productImages).values(imageRecords);
      return imageRecords.length;
    });

    return {
      message: '이미지가 성공적으로 연결되었습니다.',
      connectedImages: result,
    };
  }

  @Post('masters/:masterId/images/:uploadId')
  @ApiOperation({
    summary: '상품 마스터에 단일 이미지 연결',
    description: '업로드된 파일 1개를 상품 마스터에 연결합니다.',
  })
  @ApiParam({
    name: 'masterId',
    description: '상품 마스터 ID',
    type: 'string',
  })
  @ApiParam({
    name: 'uploadId',
    description: '업로드 파일 ID',
    type: 'string',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        isPrimary: {
          type: 'boolean',
          description: '대표이미지 여부',
          default: false,
        },
        sortOrder: {
          type: 'number',
          description: '이미지 순서 (0-5)',
          minimum: 0,
          maximum: 5,
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: '이미지 연결 성공',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        imageId: { type: 'string', description: '생성된 product_image ID' },
      },
    },
  })
  async connectSingleImageToMaster(
    @Param('masterId', ParseUUIDPipe) masterId: string,
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
    @Body() body: { isPrimary?: boolean; sortOrder?: number },
  ) {
    const { isPrimary = false, sortOrder = 0 } = body;

    // 대표이미지 중복 체크
    if (isPrimary) {
      const existingPrimary = await this.db.db
        .select()
        .from(productImages)
        .where(
          and(
            eq(productImages.masterId, masterId),
            eq(productImages.isPrimary, true),
          ),
        );

      if (existingPrimary.length > 0) {
        throw new BadRequestException(
          '이미 대표이미지가 설정되어 있습니다. 기존 대표이미지를 먼저 변경해주세요.',
        );
      }
    }

    // 업로드 파일 존재 확인
    const uploadExists = await this.db.db
      .select()
      .from(uploads)
      .where(eq(uploads.id, uploadId));

    if (uploadExists.length === 0) {
      throw new BadRequestException('존재하지 않는 업로드 파일입니다.');
    }

    // 이미지 연결
    const [imageRecord] = await this.db.db
      .insert(productImages)
      .values({
        id: uuidv7(),
        masterId,
        uploadId,
        isPrimary,
        sortOrder,
      })
      .returning();

    return {
      message: '이미지가 성공적으로 연결되었습니다.',
      imageId: imageRecord.id,
    };
  }
}
