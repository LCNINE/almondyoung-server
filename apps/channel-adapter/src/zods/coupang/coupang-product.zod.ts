import { z } from 'zod';

/**
 * 쿠팡 상품/재고 관련 Zod 스키마
 *
 * 상품 정보 및 재고 관리 도메인 스키마를 정의합니다.
 *
 * @author Channel Adapter Team
 * @version 2.0.0
 */

// =================================================================
// == 재고 업데이트 스키마 (Update Stock)
// =================================================================

export const CoupangUpdateStockResponseSchema = z.object({
  code: z.enum(['SUCCESS', 'ERROR']),
  message: z.string(),
});

// =================================================================
// == 타입 추출 (Type Exports)
// =================================================================

export type CoupangUpdateStockResponse = z.infer<typeof CoupangUpdateStockResponseSchema>;
