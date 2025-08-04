// shared/pipes/global-zod.pipe.ts
import {
    Injectable,
    PipeTransform,
    ArgumentMetadata,
    BadRequestException,
  } from '@nestjs/common';
  import { Reflector } from '@nestjs/core';
  import { ZodError, ZodType } from 'zod';
  import { ZOD_SCHEMA_KEY } from '../decorators/zod.decorator';
  
  @Injectable()
  export class GlobalZodPipe implements PipeTransform {
    constructor(private reflector: Reflector) {}
  
    transform(value: any, metadata: ArgumentMetadata) {
      const target = metadata.metatype;
      if (!target) return value;
  
      const schema = this.reflector.get<ZodType>(ZOD_SCHEMA_KEY, target);
      if (!schema) return value;
  
      // 안전하게 parse 함수가 있는지 확인
      if (typeof (schema as any).parse !== 'function') {
        return value;
      }
  
      try {
        return schema.parse(value);
      } catch (e) {
        if (e instanceof ZodError) {
          const formatted = e.issues.map(issue => ({
            field: issue.path.join('.'),
            message: issue.message,
          }));
          throw new BadRequestException({
            message: '입력값 검증에 실패했습니다',
            errors: formatted,
          });
        }
        throw e;
      }
    }
  }
  