// src/decorators/uploaded-file.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

export type FastifyFile = {
  value: Buffer; // 파일 내용
  filename: string; // 파일명
  encoding: string;
  mimetype: string;
};

export const UploadedFile = createParamDecorator(
  (fieldName: string, ctx: ExecutionContext): FastifyFile | undefined => {
    const req: FastifyRequest = ctx.switchToHttp().getRequest();
    const body: any = req.body;
    const filePart = body?.[fieldName];
    if (filePart && filePart.value && filePart.filename) {
      return filePart as FastifyFile;
    }
    return undefined;
  },
);
