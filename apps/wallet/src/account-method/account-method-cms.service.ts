/**
 * 계좌/BNPL CMS(정산/출금/배치) 서비스
 */
export class AccountMethodCmsService {
  /**
   * 월별 정산 배치 생성
   * @param userId 사용자 ID
   * @param month 대상 월(YYYY-MM)
   */
  async createMonthlyBatch(userId: number, month: string): Promise<void> {
    // 1. 해당 userId, month로 이미 배치가 있는지 조회
    // 2. 없으면 신규 배치 레코드 생성 (상태: READY)
    // 3. 관련 인보이스/결제수단/정산대상 데이터 연결
    // 4. 배치ID 반환 또는 void
  }

  /**
   * 정산 배치 실행 (스케줄러에서 호출)
   * @param batchId 배치 ID
   */
  async executeBatch(batchId: string): Promise<void> {
    // 1. 배치 상태를 IN_PROGRESS로 변경
    // 2. 배치에 포함된 인보이스/결제내역을 순회
    // 3. 각 인보이스/결제에 대해 CMS 출금/정산 시도
    // 4. 성공/실패 결과 기록
    // 5. 전체 완료 시 상태를 COMPLETED/FAILED로 변경
  }

  /**
   * 배치 상태 조회
   * @param batchId 배치 ID
   */
  async getBatchStatus(
    batchId: string,
  ): Promise<'READY' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'> {
    // 1. 배치 테이블에서 batchId로 상태 조회
    // 2. 상태값 반환
    return 'READY'; // 예시
  }

  /**
   * 미수금/미정산 내역 조회
   * @param userId 사용자 ID
   */
  async getOutstanding(
    userId: number,
  ): Promise<
    Array<{ invoiceId: number; amount: number; dueAt: string; status: string }>
  > {
    // 1. userId로 미수금/미정산 인보이스 목록 조회
    // 2. 각 인보이스의 금액, 만기일, 상태 등 반환
    return [];
  }
}
