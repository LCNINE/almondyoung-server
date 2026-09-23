import { Injectable } from '@nestjs/common';
import { ArrearsOutstandingException } from '../../shared/exceptions/subscription.exceptions';
import { ArrearsReader } from './arrears.reader';

/**
 * 미납 요금이 남은 계정은 멤버십을 새로 시작하지 못하게 하는 관문.
 *
 * 빚을 걷는 게 아니라 «갚기 전에는 새 이용을 개시하지 않는» 것이다. 그래서 결제 «전»에만 선다 —
 * 결제가 끝난 뒤(confirm·capture)에서 막으면 돈은 받고 가입은 거절하게 된다.
 * 관리자 직접 등록·무상 부여·cafe24 자동 부여는 관리자가 사정을 알고 주는 것이라 이 관문을 지나지 않는다.
 */
@Injectable()
export class ArrearsGate {
  constructor(private readonly arrearsReader: ArrearsReader) {}

  async assertNoOutstanding(userId: string): Promise<void> {
    const { total } = await this.arrearsReader.outstandingSummary(userId);
    if (total > 0) throw new ArrearsOutstandingException();
  }
}
