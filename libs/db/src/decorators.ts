import { Inject } from '@nestjs/common';
import { DbService } from './db.service';

// DB 서비스 주입을 위한 데코레이터
export const InjectDb = () => Inject(DbService);
 
// 타입 안전한 DB 서비스 주입 데코레이터 (타입 힌트용)
export function InjectTypedDb<TSchema extends Record<string, unknown>>() {
  return Inject(DbService<TSchema>);
} 