/**
 * 금액 처리 유틸리티
 * KRW 정수 변환 및 검증을 담당
 */

export class Money {
  /**
   * DB의 numeric 타입을 KRW 정수로 변환
   */
  static toKRWInt(value: unknown): number {
    if (typeof value === 'number') {
      return Math.round(value);
    }

    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      if (isNaN(parsed)) {
        throw new Error(`Invalid amount format: ${value}`);
      }
      return Math.round(parsed);
    }

    throw new Error(`Cannot convert to KRW integer: ${typeof value}`);
  }

  /**
   * 금액 배열의 합계 계산
   */
  static sum(amounts: number[]): number {
    return amounts.reduce((sum, amount) => sum + this.toKRWInt(amount), 0);
  }

  /**
   * 금액 검증 - 0 이상이어야 함
   */
  static validate(amount: number): void {
    if (!Number.isInteger(amount) || amount < 0) {
      throw new Error(
        `Invalid amount: ${amount}. Must be non-negative integer KRW`,
      );
    }
  }

  /**
   * 총 금액 일치 검증
   */
  static verifyTotal(
    sessionAmount: number,
    methodAmounts: number[],
    pointsAmount?: number,
  ): void {
    const methodTotal = this.sum(methodAmounts);
    const pointsTotal = pointsAmount ? this.toKRWInt(pointsAmount) : 0;
    const requestTotal = methodTotal + pointsTotal;
    const sessionTotal = this.toKRWInt(sessionAmount);

    if (sessionTotal !== requestTotal) {
      throw new Error(
        `Amount mismatch: session=${sessionTotal}, methods=${methodTotal}, points=${pointsTotal}, total=${requestTotal}`,
      );
    }
  }
}
