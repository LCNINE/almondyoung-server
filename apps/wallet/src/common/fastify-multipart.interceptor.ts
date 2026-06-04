import {
  BadRequestException,
  CallHandler,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { MultipartFile, MultipartValue } from '@fastify/multipart';
import { FastifyRequest } from 'fastify';
import { Observable } from 'rxjs';

export interface FastifyUploadedFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  encoding: string;
  buffer: Buffer;
  size: number;
}

@Injectable()
export class FastifyMultipartInterceptor implements NestInterceptor {
  constructor(private readonly fileFieldName = 'file') {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<FastifyRequest & { uploadedFile?: FastifyUploadedFile }>();

    if (!request.isMultipart()) {
      return next.handle();
    }

    const body: Record<string, unknown> = {};
    let uploadedFile: FastifyUploadedFile | undefined;

    try {
      for await (const part of request.parts()) {
        if (this.isFilePart(part)) {
          if (part.fieldname !== this.fileFieldName) {
            part.file.resume();
            continue;
          }
          const buffer = await part.toBuffer();
          uploadedFile = {
            fieldname: part.fieldname,
            originalname: part.filename,
            mimetype: part.mimetype,
            encoding: part.encoding,
            buffer,
            size: buffer.length,
          };
          continue;
        }

        body[part.fieldname] = part.value;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'multipart body parse failed';
      throw new BadRequestException(message);
    }

    request.body = body;
    request.uploadedFile = uploadedFile;

    return next.handle();
  }

  private isFilePart(part: MultipartFile | MultipartValue): part is MultipartFile {
    return 'file' in part;
  }
}

export const UploadedFastifyFile = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): FastifyUploadedFile | undefined => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest & { uploadedFile?: FastifyUploadedFile }>();
    return request.uploadedFile;
  },
);
