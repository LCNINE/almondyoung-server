import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import { eq, lt } from 'drizzle-orm';
import * as crypto from 'crypto';
import * as schema from '../schemas/schema';

export interface IdempotencyRecord {
  id: string; // 멱등키
  userId: string;
  requestPath: string;
  requestHash: string;
  responseCode?: number;
  responseBody?: string;
  status: 'PROCESSING' | 'COMPLETED';
  createdAt: Date;
  expiresAt: Date;
}

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>
  ) {
    this.logger.log('🔧 [IdempotencyService] 서비스 초기화됨');
  }

  /**
   * 멱등키 조회
   * 만료된 키는 자동으로 삭제하고 null 반환
   */
  async findIdempotencyKey(key: string): Promise<IdempotencyRecord | null> {
    try {
      this.logger.log(`🔍 [IdempotencyService] 멱등키 조회 시작: ${key}`);

      const record = await this.dbService.db.query.idempotencyKeys.findFirst({
        where: eq(schema.idempotencyKeys.id, key),
      });

      if (!record) {
        this.logger.log(`🔍 [IdempotencyService] 멱등키 없음: ${key}`);
        return null;
      }

      // 만료된 키 확인 및 삭제
      if (new Date() > record.expiresAt) {
        this.logger.log(`🔍 [IdempotencyService] 만료된 멱등키 발견, 삭제 처리: ${key}`);
        await this.deleteIdempotencyKey(key);
        return null;
      }

      this.logger.log(`🔍 [IdempotencyService] 멱등키 조회 성공: ${key} (상태: ${record.status})`);
      return record as IdempotencyRecord;

    } catch (error) {
      this.logger.error(`🚨 [IdempotencyService] 멱등키 조회 실패: ${key}`, error);
      throw new InternalServerErrorException('멱등키 조회 중 오류가 발생했습니다.');
    }
  }

  /**
   * 멱등키 생성 (처리 시작)
   * 24시간 후 만료되도록 설정
   */
  async createIdempotencyKey(
    key: string,
    userId: string,
    requestPath: string,
    requestBody: any
  ): Promise<void> {
    try {
      this.logger.log(`💾 [IdempotencyService] 멱등키 생성 시작: ${key} (사용자: ${userId})`);

      const requestHash = this.generateRequestHash(requestBody);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24시간 후

      this.logger.log(`💾 [IdempotencyService] DB INSERT 실행 중: ${key}`);

      const result = await this.dbService.db.insert(schema.idempotencyKeys).values({
        id: key,
        userId,
        requestPath,
        requestHash,
        status: 'PROCESSING',
        expiresAt,
      });

      this.logger.log(`💾 [IdempotencyService] DB INSERT 결과:`, result);
      this.logger.log(`💾 [IdempotencyService] 멱등키 생성 완료: ${key} (만료: ${expiresAt.toISOString()})`);

      // 생성 직후 바로 조회해서 확인
      const verification = await this.dbService.db.query.idempotencyKeys.findFirst({
        where: eq(schema.idempotencyKeys.id, key),
      });

      if (verification) {
        this.logger.log(`✅ [IdempotencyService] 생성 검증 성공: ${key} (상태: ${verification.status})`);
      } else {
        this.logger.error(`❌ [IdempotencyService] 생성 검증 실패: ${key} - DB에서 찾을 수 없음`);
      }

    } catch (error) {
      this.logger.error(`🚨 [IdempotencyService] 멱등키 생성 실패: ${key}`, error);
      throw new InternalServerErrorException('멱등키 생성 중 오류가 발생했습니다.');
    }
  }

  /**
   * 멱등키 완료 처리 (응답 저장)
   */
  async completeIdempotencyKey(
    key: string,
    responseCode: number,
    responseBody: any
  ): Promise<void> {
    try {
      this.logger.log(`멱등키 완료 처리 시작: ${key} (응답 코드: ${responseCode})`);

      await this.dbService.db
        .update(schema.idempotencyKeys)
        .set({
          status: 'COMPLETED',
          responseCode,
          responseBody: JSON.stringify(responseBody),
        })
        .where(eq(schema.idempotencyKeys.id, key));

      this.logger.log(`멱등키 완료 처리 성공: ${key}`);
    } catch (error) {
      this.logger.error(`멱등키 완료 처리 실패: ${key}`, error);
      throw new InternalServerErrorException('멱등키 완료 처리 중 오류가 발생했습니다.');
    }
  }

  /**
   * 멱등키 삭제 (실패 시 또는 만료 시)
   */
  async deleteIdempotencyKey(key: string): Promise<void> {
    try {
      await this.dbService.db
        .delete(schema.idempotencyKeys)
        .where(eq(schema.idempotencyKeys.id, key));

      this.logger.log(`멱등키 삭제 완료: ${key}`);
    } catch (error) {
      this.logger.error(`멱등키 삭제 실패: ${key}`, error);
      // 삭제 실패는 치명적이지 않으므로 예외를 던지지 않음
    }
  }

  /**
   * 요청 해시 생성
   * 객체 키를 정렬하여 일관된 해시 생성
   */
  generateRequestHash(requestBody: any): string {
    try {
      // 재귀적으로 객체를 정렬하는 함수
      const sortObject = (obj: any): any => {
        if (obj === null || typeof obj !== 'object') {
          return obj;
        }
        
        if (Array.isArray(obj)) {
          return obj.map(sortObject);
        }
        
        const sortedObj: any = {};
        Object.keys(obj).sort().forEach(key => {
          sortedObj[key] = sortObject(obj[key]);
        });
        
        return sortedObj;
      };

      // 정렬된 객체를 JSON 문자열로 변환
      const sortedBody = sortObject(requestBody || {});
      const sortedBodyString = JSON.stringify(sortedBody);

      // SHA-256 해시 생성
      const hash = crypto.createHash('sha256').update(sortedBodyString).digest('hex');

      this.logger.log(`🔍 [IdempotencyService] 요청 해시 생성:`);
      this.logger.log(`🔍 [IdempotencyService] 원본 요청: ${JSON.stringify(requestBody)}`);
      this.logger.log(`🔍 [IdempotencyService] 정렬된 요청: ${sortedBodyString}`);
      this.logger.log(`🔍 [IdempotencyService] 생성된 해시: ${hash.substring(0, 16)}...`);
      
      return hash;
    } catch (error) {
      this.logger.error('🚨 [IdempotencyService] 요청 해시 생성 실패', error);
      throw new InternalServerErrorException('요청 해시 생성 중 오류가 발생했습니다.');
    }
  }

  /**
   * 요청 해시 검증
   * 저장된 해시와 현재 요청의 해시를 비교
   */
  validateRequestHash(storedHash: string, currentBody: any): boolean {
    try {
      const currentHash = this.generateRequestHash(currentBody);
      const isValid = storedHash === currentHash;

      this.logger.debug(`요청 해시 검증: ${isValid ? '일치' : '불일치'}`);
      if (!isValid) {
        this.logger.warn(`해시 불일치 - 저장된: ${storedHash.substring(0, 8)}..., 현재: ${currentHash.substring(0, 8)}...`);
      }

      return isValid;
    } catch (error) {
      this.logger.error('요청 해시 검증 실패', error);
      return false;
    }
  }

  /**
   * 만료된 멱등키 정리 (스케줄러에서 호출)
   * 배치 삭제로 성능 최적화
   */
  async cleanupExpiredKeys(): Promise<number> {
    try {
      this.logger.log('만료된 멱등키 정리 시작');

      const result = await this.dbService.db
        .delete(schema.idempotencyKeys)
        .where(lt(schema.idempotencyKeys.expiresAt, new Date()));

      const deletedCount = result.rowCount || 0;
      this.logger.log(`만료된 멱등키 정리 완료: ${deletedCount}개 삭제`);

      return deletedCount;
    } catch (error) {
      this.logger.error('만료된 멱등키 정리 실패', error);
      throw new InternalServerErrorException('만료된 멱등키 정리 중 오류가 발생했습니다.');
    }
  }

  /**
   * 사용자별 멱등키 개수 조회 (Rate Limiting용)
   */
  async getUserIdempotencyKeyCount(userId: string): Promise<number> {
    try {
      const result = await this.dbService.db
        .select({ count: schema.idempotencyKeys.id })
        .from(schema.idempotencyKeys)
        .where(eq(schema.idempotencyKeys.userId, userId));

      return result.length;
    } catch (error) {
      this.logger.error(`사용자 멱등키 개수 조회 실패: ${userId}`, error);
      return 0;
    }
  }
}