import { Injectable, Logger } from '@nestjs/common';
import { BadRequestError } from '@app/shared';
import { DbService } from '@app/db';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import { PaymentClientService } from '../billing/payment-client.service';
import { ArrearsManager } from './arrears.manager';
import { ArrearsReader, ArrearsRow } from './arrears.reader';
import { arrearsIdsFromMetadata, isArrearsPayment } from './arrears-payment.metadata';

export interface MyArrearsView {
  outstanding: { total: number; count: number; currency: string };
  items: ArrearsRow[];
}

export interface StartRepaymentResult {
  intentId: string;
  amount: number;
  currency: string;
  arrearsIds: string[];
}

/**
 * 고객이 스스로 미수를 갚는 경로.
 *
 * 왜 «전액 한 번»인가(부분 청산 불허): 선지급 게이트는 잔액 **합**이 0 인지로 판단한다
 * (`invoice-billing.manager` 의 `outstandingTotal`). 부분 청산을 허용하면 고객은 돈을 냈는데
 * 자격은 그대로 막힌 상태가 되고, 그건 안 받는 것보다 나쁘다. 금액이 커서 한 번에 못 갚는 건은
 * 관리자 면제·금액 조정(`waive`/`adjustAmount`)이 이미 덮는다.
 *
 * 왜 «capture 이벤트»만 권위인가: 이 결제는 wallet 에서 무통장으로만 받는다(멤버십 요금 정책).
 * 결제 직후 intent 는 입금 대기 상태라 동기 콜백으로는 성공을 판정할 수 없고, 콜백을 믿으면
 * 이탈한 결제가 「돈은 들어왔는데 원장은 열린 채」로 남는다. 청산은 `payment.intent.captured`
 * 한 경로에서만 일어난다.
 */
@Injectable()
export class ArrearsRepaymentService {
  private readonly logger = new Logger(ArrearsRepaymentService.name);

  constructor(
    private readonly dbService: DbService<typeof membershipSchema>,
    private readonly arrearsReader: ArrearsReader,
    private readonly arrearsManager: ArrearsManager,
    private readonly paymentClientService: PaymentClientService,
  ) {}

  /** 본인 미수 현황. 스코프는 호출자가 넘긴 JWT userId 하나뿐이다. */
  async getMine(userId: string): Promise<MyArrearsView> {
    const [outstanding, items] = await Promise.all([
      this.arrearsReader.outstandingSummary(userId),
      this.arrearsReader.findOutstandingByUserId(userId),
    ]);
    return { outstanding, items };
  }

  /**
   * 청산 결제 시작. 금액은 **원장에서 더한다** — 클라이언트가 보낸 금액을 믿으면 1원 결제로
   * 미수를 지울 수 있다. 어느 줄을 덮는지도 여기서 확정해 intent metadata 에 싣는다.
   */
  async startRepayment(userId: string, returnUrl: string, email?: string): Promise<StartRepaymentResult> {
    const items = await this.arrearsReader.findOutstandingByUserId(userId);
    if (items.length === 0) {
      throw new BadRequestError('청산할 미수가 없습니다.');
    }

    const currencies = new Set(items.map((i) => i.currency));
    if (currencies.size > 1) {
      // 통화가 섞이면 한 번의 결제로 덮을 수 없다. 지금은 발생할 수 없지만(전부 KRW),
      // 조용히 더해 엉뚱한 금액을 청구하는 대신 막는다.
      throw new BadRequestError('통화가 다른 미수가 섞여 있어 한 번에 청산할 수 없습니다. 고객센터로 문의해 주세요.');
    }

    const currency = items[0].currency;
    const amount = items.reduce((sum, i) => sum + i.amount, 0);
    const arrearsIds = items.map((i) => i.id);

    const { intentId } = await this.paymentClientService.createArrearsCheckoutIntent({
      userId,
      amount,
      currency,
      returnUrl,
      email,
      arrearsIds,
    });

    this.logger.log(
      `[arrears] 청산 결제 생성: userId=${userId}, intentId=${intentId}, amount=${amount}, count=${arrearsIds.length}`,
    );

    return { intentId, amount, currency, arrearsIds };
  }

  /**
   * 입금이 확인된 청산 결제를 원장에 반영한다. 이벤트는 재전달되므로 두 번 와도 두 번째는 0건이다.
   *
   * intent 의 metadata 를 이벤트 payload 가 아니라 **wallet 에 다시 물어서** 읽는다 —
   * 상태(CAPTURED)와 대상 목록을 같은 출처에서 봐야 「이벤트만 오고 돈은 안 들어온」 경우가 갈린다.
   */
  async settleFromCapturedIntent(intentId: string): Promise<void> {
    const intent = await this.paymentClientService.getWalletPaymentIntent(intentId);

    if (!isArrearsPayment(intent.metadata)) return;

    if (intent.status !== 'CAPTURED') {
      this.logger.warn(`[arrears] 청산 스킵 — 캡처 상태가 아님 (intentId=${intentId}, status=${intent.status})`);
      return;
    }

    const userId = typeof intent.metadata?.userId === 'string' ? intent.metadata.userId : undefined;
    const arrearsIds = arrearsIdsFromMetadata(intent.metadata);
    if (!userId || arrearsIds.length === 0) {
      this.logger.error(`[arrears] 청산 불가 — intent metadata 에 userId/arrearsIds 가 없다 (intentId=${intentId})`);
      return;
    }

    const settled = await this.dbService.db.transaction((tx) =>
      this.arrearsManager.settleMany(tx, userId, arrearsIds, `intent:${intentId}`),
    );

    if (settled.length === arrearsIds.length) {
      this.logger.log(`[arrears] 청산 완료: userId=${userId}, intentId=${intentId}, count=${settled.length}`);
      return;
    }

    if (settled.length === 0) {
      // 같은 결제가 두 번 배달된 경우가 대부분이다(정상). 하지만 결제 «전에» 관리자가 면제했다면
      // 고객이 낸 돈이 갈 곳이 없다 — 사람이 봐야 하므로 id 를 남긴다.
      this.logger.warn(
        `[arrears] 청산할 줄이 없다 — 이미 청산·면제됐을 수 있다 (intentId=${intentId}, userId=${userId}, ids=${arrearsIds.join(',')})`,
      );
      return;
    }

    this.logger.error(
      `[arrears] 부분 청산 — 결제는 전액인데 일부만 닫혔다. 수동 확인 필요 ` +
        `(intentId=${intentId}, userId=${userId}, 요청=${arrearsIds.length}, 청산=${settled.length})`,
    );
  }
}
