import { StoreCancelUnavailableReason } from '../dto/store-order-actions.dto';

export interface SelfCancelFacts {
  orderStatus: string;
  salesChannel: string;
  hasShippedEvidence: boolean;
  pickingStarted: boolean;
  hasRecoveryBox: boolean;
}

export interface SelfCancelBlock {
  reason: StoreCancelUnavailableReason;
  message: string;
}

/**
 * 고객 셀프취소를 막는 사유. 버튼(availableActions)과 서버 거절이 이 하나를 같이 쓴다 — 둘이 갈리면 버튼은 보이는데 409 가 난다(#1016 33번).
 * 다운로드 확인은 쿼리라 앞 사실이 다 통과했을 때만 부른다(주문 목록은 주문마다 이 판정을 한다).
 * `timeout` 과 인쇄 취소 거절은 이 판정 밖이다.
 */
export async function selfCancelBlock(
  facts: SelfCancelFacts,
  digitalDownloaded: () => Promise<boolean>,
): Promise<SelfCancelBlock | null> {
  if (facts.orderStatus === 'cancelled') return { reason: 'already_cancelled', message: '이미 취소된 주문입니다.' };
  if (facts.hasShippedEvidence) {
    return { reason: 'already_shipped', message: '이미 출고된 주문은 취소할 수 없습니다. 고객센터로 문의해 주세요.' };
  }
  if (facts.salesChannel !== 'medusa') {
    return {
      reason: 'channel_order',
      message: `${facts.salesChannel} 채널 주문은 해당 채널에서 직접 취소해 주세요.`,
    };
  }
  if (facts.pickingStarted) {
    return {
      reason: 'already_processing',
      message: '피킹이 시작된 주문은 직접 취소할 수 없습니다. 고객센터로 문의해 주세요.',
    };
  }
  if (facts.hasRecoveryBox) {
    return {
      reason: 'already_processing',
      message: '처리 중인 주문이라 직접 취소할 수 없습니다. 고객센터로 문의해 주세요.',
    };
  }
  if (await digitalDownloaded()) {
    return {
      reason: 'digital_downloaded',
      message: '이미 다운로드한 디지털 상품이 포함된 주문입니다. 직접 취소가 불가하니 고객센터로 문의해 주세요.',
    };
  }
  return null;
}
