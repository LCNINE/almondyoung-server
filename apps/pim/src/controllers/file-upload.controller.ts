import { Controller, Post, Req, BadRequestException } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiBody,
  ApiResponse,
} from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { join } from 'path';
import { promises as fs } from 'fs';
import { uploads } from '../schema'; // uploads 테이블
import { v7 as uuidv7 } from 'uuid';
import { DbService } from '@app/db';
import { PimSchema } from '../schema';

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
}
