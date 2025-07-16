/**
 * ID 타입 어댑터
 * 
 * 기존 number 타입 ID와 새로운 string 타입 ID 간의 호환성을 제공
 * 점진적 마이그레이션을 위한 어댑터 패턴
 */

import { UserId, InvoiceId, LegacyIdConverter } from '../types/id.types';

/**
 * 유니온 타입으로 기존 ID와 새 ID 모두 지원
 */
export type CompatibleUserId = UserId | number;
export type CompatibleInvoiceId = InvoiceId | string;

/**
 * ID 어댑터 클래스
 */
export class IdAdapter {
  /**
   * 사용자 ID를 정규화 (number → string 변환)
   */
  static normalizeUserId(id: CompatibleUserId): UserId {
    if (typeof id === 'number') {
      return LegacyIdConverter.convertLegacyUserId(id);
    }
    return id;
  }

  /**
   * 사용자 ID를 레거시 형식으로 변환 (DB 조회용)
   */
  static toLegacyUserId(id: CompatibleUserId): number | null {
    if (typeof id === 'number') {
      return id;
    }
    
    // 새 형식이 레거시 변환된 것인지 확인
    if (LegacyIdConverter.isLegacyId(id)) {
      return LegacyIdConverter.extractLegacyNumber(id);
    }
    
    return null; // 완전히 새로운 형식
  }

  /**
   * 인보이스 ID 정규화
   */
  static normalizeInvoiceId(id: CompatibleInvoiceId): InvoiceId {
    if (typeof id === 'string') {
      const parsed = parseInt(id, 10);
      if (isNaN(parsed)) {
        throw new Error(`Invalid invoice ID format: ${id}`);
      }
      return parsed;
    }
    return id;
  }

  /**
   * ID가 새 형식인지 확인
   */
  static isNewFormat(id: CompatibleUserId): id is UserId {
    return typeof id === 'string';
  }

  /**
   * ID가 레거시 형식인지 확인
   */
  static isLegacyFormat(id: CompatibleUserId): id is number {
    return typeof id === 'number';
  }
}

/**
 * 서비스 레이어에서 사용할 헬퍼 함수들
 */
export const IdHelpers = {
  /**
   * 사용자 조회 시 ID 변환
   */
  async findUserById<T>(
    id: CompatibleUserId,
    finder: (legacyId: number) => Promise<T | null>,
    newFinder?: (newId: UserId) => Promise<T | null>
  ): Promise<T | null> {
    // 레거시 ID인 경우
    const legacyId = IdAdapter.toLegacyUserId(id);
    if (legacyId !== null) {
      return finder(legacyId);
    }

    // 새 형식 ID인 경우
    if (newFinder && typeof id === 'string') {
      return newFinder(id);
    }

    return null;
  },

  /**
   * 배치 ID 변환
   */
  normalizeBatchUserIds(ids: CompatibleUserId[]): {
    legacyIds: number[];
    newIds: UserId[];
  } {
    const legacyIds: number[] = [];
    const newIds: UserId[] = [];

    ids.forEach(id => {
      const legacyId = IdAdapter.toLegacyUserId(id);
      if (legacyId !== null) {
        legacyIds.push(legacyId);
      } else if (typeof id === 'string') {
        newIds.push(id);
      }
    });

    return { legacyIds, newIds };
  },
};