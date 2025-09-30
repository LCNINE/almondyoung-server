import {
  Controller,
  Post,
  Body,
  Req,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { ImageService } from '../services/image.service';

@ApiTags('File Upload')
@Controller('uploads')
export class FileUploadController {
  constructor(private readonly imageService: ImageService) {}

  @Post('images')
  @ApiOperation({
    summary: '이미지 파일 업로드',
    description: 'Fastify multipart를 사용한 이미지 파일 업로드',
  })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({
    status: 201,
    description: '이미지 업로드 성공',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        data: {
          type: 'object',
          properties: {
            uploadId: { type: 'string' },
            url: { type: 'string' },
            fileName: { type: 'string' },
            originalName: { type: 'string' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: '잘못된 파일 형식 또는 크기' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async uploadImage(@Req() req: FastifyRequest) {
    try {
      const data = await req.file();
      
      if (!data) {
        throw new HttpException(
          '파일이 업로드되지 않았습니다.',
          HttpStatus.BAD_REQUEST,
        );
      }

      const result = await this.imageService.uploadFile(data);

      return {
        success: true,
        message: '이미지 업로드 성공',
        data: result,
      };
    } catch (error) {
      if (error.message.includes('Invalid image format')) {
        throw new HttpException(
          '이미지 파일만 업로드 가능합니다.',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (error.message.includes('File size exceeds limit')) {
        throw new HttpException(
          '파일 크기가 제한을 초과했습니다.',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw new HttpException(
        `이미지 업로드 실패: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('url')
  @ApiOperation({
    summary: 'URL에서 이미지 다운로드',
    description: 'URL에서 이미지를 다운로드하여 저장',
  })
  @ApiResponse({
    status: 201,
    description: 'URL 이미지 다운로드 성공',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        data: {
          type: 'object',
          properties: {
            uploadId: { type: 'string' },
            url: { type: 'string' },
            fileName: { type: 'string' },
            originalName: { type: 'string' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: '잘못된 URL 또는 이미지 형식' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async uploadFromUrl(@Body() body: { url: string }) {
    try {
      const { url } = body;

      if (!url) {
        throw new HttpException(
          'URL이 제공되지 않았습니다.',
          HttpStatus.BAD_REQUEST,
        );
      }

      const result = await this.imageService.uploadFromUrl(url);

      return {
        success: true,
        message: 'URL 이미지 다운로드 성공',
        data: result,
      };
    } catch (error) {
      if (error.message.includes('Invalid image format')) {
        throw new HttpException(
          '유효하지 않은 이미지 형식입니다.',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (error.message.includes('Failed to download')) {
        throw new HttpException(
          '이미지 다운로드에 실패했습니다.',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw new HttpException(
        `URL 이미지 처리 실패: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
