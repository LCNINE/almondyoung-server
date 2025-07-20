import { CreatePaymentMethodPayload } from '../../shared/zod/payment-method.zod';
import * as schema from '../../shared/schemas/schema';
import { WalletTx } from '../../shared/types';

// 포트(계약서)는 구체적인 구현이 아닌, '약속'만 정의합니다.
export abstract class MethodManagementPort {
  /**
   * 결제수단을 외부 PG사에 등록합니다.
   * @param request 사용자가 입력한 등록 정보 DTO
   * @param tx 진행 중인 DB 트랜잭션 객체
   * @param paymentMethod 우리 DB에 먼저 생성된 부모 paymentMethod 레코드
   */
  abstract registerMember(
    request: CreatePaymentMethodPayload,
    tx: WalletTx,
    paymentMethod: typeof schema.paymentMethod.$inferSelect,
  ): Promise<any>; // 반환 타입은 어댑터의 API 응답에 따라 유연하게 설정

  /**
   * 외부 PG사에 등록된 회원의 상태를 조회합니다.
   * @param memberId PG사가 발급한 회원 ID
   */
  abstract getMemberStatus(
    memberId: string,
  ): Promise<{ status: 'PENDING' | 'REGISTERED' | 'FAILED' }>;
}
