import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
  createParamDecorator,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { FastifyRequest } from 'fastify';
import { ValidatedFile } from '../services/file-upload.service';

export const FastifyFile = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): ValidatedFile => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest>();
    return (request as any).file;
  },
);

export function FastifyFileInterceptor(fieldName: string) {
  return function (
    target: any,
    propertyName: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const context = args.find((arg) => arg && arg.switchToHttp);
      if (context) {
        const request = context.switchToHttp().getRequest() as FastifyRequest;

        try {
          const data = await request.file();

          if (!data) {
            throw new BadRequestException('파일이 업로드되지 않았습니다');
          }

          const buffer = await data.file.toBuffer();

          const file: ValidatedFile = {
            filename: data.filename,
            buffer,
            mimetype: data.mimetype,
            size: buffer.length,
          };

          (request as any).file = file;
        } catch (error) {
          throw new BadRequestException('파일 처리 중 오류가 발생했습니다');
        }
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}
