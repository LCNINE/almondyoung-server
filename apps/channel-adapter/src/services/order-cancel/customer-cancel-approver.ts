// apps/channel-adapter/src/services/order-cancel/customer-cancel-approver.ts
import { HttpException, Injectable, Logger, Optional } from '@nestjs/common';
import type { CancelChannelOrderPayload } from '@packages/event-contracts/streams';
import { CoupangReturnClient } from '../../adapters/coupang/clients/coupang-return.client.service';
import { NaverClaimClient } from '../../adapters/naver/clients/naver-claim.client';
import { getChannelFulfillmentCapabilities } from '../channel-capabilities';

/**
 * 마켓 고객이 낸 취소요청에 «승인»을 보낸다 (스펙 §2·§5.3).
 *
 * 채널별 스위치: env `CHANNEL_CANCEL_APPROVAL_ACT_CHANNELS`(쉼표 목록)에 든 채널, 또는 옛 `CHANNEL_CANCEL_APPROVAL_MODE=act`(두 채널 모두)일
 * 때만 마켓을 부른다. 그 밖(미설정 포함)은 관찰 모드 —
 * 부르지 않고 «승인했을 것»만 로그에 남기고 영구 실패(`approval_observe_mode`)로 끝낸다.
 * 리컨실러가 관찰 모드에서 같은 명령을 계속 재발행하지 않게 하고, 정산 화면에 «판매자센터에서 승인 필요»를 띄운다.
 * 호출 시점에 읽는다(재기동 없이 바뀌는 값은 아니지만 spec 이 값을 바꿔 가며 확인한다).
 */

export type ApprovalResult =
  | { kind: 'approved' }
  | { kind: 'failed'; retryable: boolean; failureCode: string; message: string };

export type ApprovalCommand = CancelChannelOrderPayload & {
  answers: NonNullable<CancelChannelOrderPayload['answers']>;
};

/**
 * 네이버가 «이미 승인됨»으로 답할 때 failProductOrderInfos 의 code.
 * 공식 값을 아직 확인하지 못했다 — shadow 점검에서 확정.
 */
export const NAVER_ALREADY_APPROVED_CODE = '104102';

/** 그 채널의 승인을 실제로 마켓에 보낼지. 호출 시점의 env 를 읽는다. */
export function isApprovalActFor(channel: 'naver' | 'coupang', env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CHANNEL_CANCEL_APPROVAL_MODE === 'act') return true;
  const channels = (env.CHANNEL_CANCEL_APPROVAL_ACT_CHANNELS ?? '').split(',').map((name) => name.trim());
  return channels.includes(channel);
}

const OBSERVE_MESSAGE = '관찰 모드 — 판매자센터에서 취소를 승인하세요.';

@Injectable()
export class CustomerCancelApprover {
  private readonly logger = new Logger(CustomerCancelApprover.name);

  // 클라이언트는 safe demo 모드에서 provider 에 없다
  constructor(
    @Optional() private readonly naverClaimClient?: NaverClaimClient,
    @Optional() private readonly coupangReturnClient?: CoupangReturnClient,
  ) {}

  async approve(command: ApprovalCommand): Promise<ApprovalResult> {
    const { salesChannel, answers, requestId } = command;
    if (!answers.needsApproval) return { kind: 'approved' };
    // 승인 실행부가 있는 채널은 둘뿐이다 — 능력 축이 켜도 실행부를 더하기 전엔 여기서 거절한다
    if (
      (salesChannel !== 'naver' && salesChannel !== 'coupang') ||
      !getChannelFulfillmentCapabilities(salesChannel)?.approvesCustomerCancelRequest
    ) {
      return failed(false, 'channel_not_supported', `${salesChannel} 채널은 취소요청 승인을 지원하지 않습니다`);
    }
    if (!isApprovalActFor(salesChannel)) {
      this.logger.log(`[CANCEL-APPROVE] ${requestId} ${salesChannel}:${answers.channelRequestRef} 관찰 모드 — 승인했을 것`);
      return failed(false, 'approval_observe_mode', OBSERVE_MESSAGE);
    }
    switch (salesChannel) {
      case 'naver':
        return this.approveNaver(answers.channelRequestRef);
      case 'coupang':
        return this.approveCoupang(command);
    }
  }

  private async approveNaver(productOrderId: string): Promise<ApprovalResult> {
    if (!this.naverClaimClient) return failed(false, 'channel_not_supported', '네이버 클라이언트를 쓸 수 없습니다');
    try {
      const response = await this.naverClaimClient.approveCancel(productOrderId);
      const fail = response.data?.failProductOrderInfos.find((info) => info.productOrderId === productOrderId);
      if (!fail) return { kind: 'approved' };
      if (fail.code === NAVER_ALREADY_APPROVED_CODE) return { kind: 'approved' };
      return failed(false, fail.code, fail.message);
    } catch (error) {
      return classifyThrown(error);
    }
  }

  private async approveCoupang(command: ApprovalCommand): Promise<ApprovalResult> {
    if (!this.coupangReturnClient) return failed(false, 'channel_not_supported', '쿠팡 클라이언트를 쓸 수 없습니다');
    const receiptId = command.answers.channelRequestRef;
    if (!/^\d+$/.test(receiptId) || /^0+$/.test(receiptId)) {
      return failed(false, 'invalid_request_ref', `쿠팡 접수번호가 올바르지 않습니다: ${command.answers.channelRequestRef}`);
    }
    const vendorId = process.env.COUPANG_VENDOR_ID;
    if (!vendorId) return failed(false, 'coupang_not_configured', '쿠팡 판매자 ID 가 설정되지 않았습니다');
    try {
      // 취소 수량은 명령의 줄이 아니라 접수 자신의 총 취소수량이다 — 부분 줄 합으로 보내면 접수 전체가 못 닫힌다
      const cancelCount = cancelCountOf(await this.coupangReturnClient.getSingleReturnRequest(receiptId));
      if (cancelCount === undefined) {
        return failed(false, 'coupang_cancel_count_unknown', '쿠팡 출고중지완료에 필요한 취소 수량을 알 수 없습니다');
      }
      const response = await this.coupangReturnClient.stoppedShipment({ vendorId, receiptId, cancelCount });
      if (response.data.resultCode === 'SUCCESS') return { kind: 'approved' };
      return failed(false, 'coupang_stop_shipment_failed', response.data.resultMessage ?? '출고중지완료 처리 실패');
    } catch (error) {
      return classifyThrown(error);
    }
  }
}

/** 단건 조회 봉투에서 총 취소수량을 읽는다. code 가 200 이 아니거나 data 가 비었거나 수량이 양의 정수가 아니면 undefined. */
function cancelCountOf(body: { code?: number; data?: unknown }): number | undefined {
  if (body.code !== undefined && body.code !== 200) return undefined;
  const record: unknown = Array.isArray(body.data) ? body.data[0] : body.data;
  if (typeof record !== 'object' || record === null || !('cancelCountSum' in record)) return undefined;
  const sum = record.cancelCountSum;
  return typeof sum === 'number' && Number.isInteger(sum) && sum > 0 ? sum : undefined;
}

function failed(retryable: boolean, failureCode: string, message: string): ApprovalResult {
  return { kind: 'failed', retryable, failureCode, message };
}

/** 4xx(429 제외)는 다시 해도 같다. 5xx·429·응답 없음(네트워크)·알 수 없는 오류는 재시도한다. */
function classifyThrown(error: unknown): ApprovalResult {
  const message = error instanceof Error ? error.message : String(error);
  const status = statusOf(error);
  if (status !== undefined && status >= 400 && status < 500 && status !== 429) {
    return failed(false, `http_${status}`, message);
  }
  return failed(true, status !== undefined ? `http_${status}` : 'transient', message);
}

/** axios(`response.status`) · Nest `HttpException`(`getStatus()`) · 쿠팡 클라이언트가 싣는 `status` 에서 HTTP 상태를 읽는다 */
function statusOf(error: unknown): number | undefined {
  if (error instanceof HttpException) return error.getStatus();
  if (typeof error !== 'object' || error === null) return undefined;
  if ('response' in error) {
    const { response } = error;
    if (typeof response === 'object' && response !== null && 'status' in response && typeof response.status === 'number') {
      return response.status;
    }
  }
  return 'status' in error && typeof error.status === 'number' ? error.status : undefined;
}
