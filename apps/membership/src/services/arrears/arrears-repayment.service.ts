import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BadRequestError } from '@app/shared';
import { DbService } from '@app/db';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import { PaymentClientService, WalletPaymentIntentStatus } from '../billing/payment-client.service';
import { ArrearsManager, SettlementTargetRow } from './arrears.manager';
import { ArrearsReader, ArrearsRow } from './arrears.reader';
import { arrearsIdsFromMetadata, isArrearsPayment } from './arrears-payment.metadata';
import { ContractEventManager } from '../subscription/contract-event.manager';
import { DrizzleTransaction } from '../../shared/schemas/types';

/**
 * 받은 돈과 지울 빚이 어긋나 «사람이 수습해야 하는» 청산. 로그로만 남기면 관리자 화면에 안 나오고,
 * 안 나오는 일은 아무도 안 본다.
 */
export const ARREARS_SETTLEMENT_MISMATCH = 'ARREARS_SETTLEMENT_MISMATCH';

/**
 * 아직 «낼 수 있는» 결제 상태. wallet 의 만료 크론이 닫는 대상과 같은 목록이다
 * (`apps/wallet/src/jobs/expiration.job.ts` 의 `EXPIRABLE_INTENT_STATUSES`).
 * 여기 없는 상태(취소·실패·이미 캡처)는 다시 보내도 고객이 낼 수 없으므로 새로 만들어야 한다.
 */
const REUSABLE_INTENT_STATUSES: ReadonlySet<WalletPaymentIntentStatus> = new Set([
  'CREATED',
  'PROCESSING',
  'REQUIRES_ACTION',
  'AWAITING_DEPOSIT',
]);

function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = new Set(a);
  return b.every((id) => left.has(id));
}

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
    private readonly contractEventManager: ContractEventManager,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 결제 뒤 돌아갈 곳. 형식만 보고 넘기면 이 라우트가 임의 사이트로 튕겨 보내는 발판이 된다 —
   * 결제 직후라 고객이 가장 속기 쉬운 순간이다. 쇼핑몰 주소를 아는 환경에서는 같은 출처만 받는다.
   */
  private assertAllowedReturnUrl(returnUrl: string): void {
    let parsed: URL;
    try {
      parsed = new URL(returnUrl);
    } catch {
      throw new BadRequestError('returnUrl 형식이 올바르지 않습니다.');
    }

    // http(s) 가 아니면 주소가 아니라 «스크립트»일 수 있다(javascript:·data:). URL 파서는 그걸
    // 정상으로 받아들이므로 여기서 걸러야 한다 — 설정이 없는 환경에서도 이 검사는 항상 돈다.
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new BadRequestError('returnUrl 형식이 올바르지 않습니다.');
    }

    const storefrontUrl = this.configService.get<string>('STOREFRONT_URL');
    // 주소를 모르는 환경(로컬·과도기)에서는 형식 검사까지만 한다. 여기서 막으면 설정이 없는 곳의
    // 정상 결제가 통째로 죽는다.
    if (!storefrontUrl) return;

    try {
      if (new URL(storefrontUrl).origin !== parsed.origin) {
        throw new BadRequestError('returnUrl 이 허용된 주소가 아닙니다.');
      }
    } catch (err) {
      if (err instanceof BadRequestError) throw err;
      this.logger.warn(`[arrears] STOREFRONT_URL 을 해석할 수 없어 출처 검사를 건너뛴다: ${storefrontUrl}`);
    }
  }

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
    this.assertAllowedReturnUrl(returnUrl);

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

    const reusableIntentId = await this.findReusableIntentId(userId, arrearsIds, amount);
    if (reusableIntentId) {
      this.logger.log(
        `[arrears] 진행 중 청산 결제 재사용: userId=${userId}, intentId=${reusableIntentId}, amount=${amount}`,
      );
      return { intentId: reusableIntentId, amount, currency, arrearsIds };
    }

    const { intentId } = await this.paymentClientService.createArrearsCheckoutIntent({
      userId,
      amount,
      currency,
      returnUrl,
      email,
      arrearsIds,
    });

    // 표식이 없어도 결제 자체는 성립한다 — 여기서 던지면 «돈 낼 수 있는 결제»를 만들어 놓고
    // 고객에게 실패를 보여주게 된다. 다음 연타를 못 막는 대신 결제를 살린다.
    try {
      await this.arrearsManager.markPendingIntent(userId, arrearsIds, intentId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[arrears] 진행 중 결제 표식 실패 — 연타 시 결제가 하나 더 생길 수 있다: ${message}`);
    }

    this.logger.log(
      `[arrears] 청산 결제 생성: userId=${userId}, intentId=${intentId}, amount=${amount}, count=${arrearsIds.length}`,
    );

    return { intentId, amount, currency, arrearsIds };
  }

  /**
   * 직전에 만든 청산 결제가 아직 살아 있으면 그것을 다시 쓴다. 무통장이라 결제 화면을 떠난 뒤에도
   * 가상계좌가 살아 있어서, 새로 만들어 주면 «같은 빚에 두 번 입금»이 가능해진다. 두 번째 입금은
   * 지울 줄이 없어 돈만 들어오고 사람이 환불해야 한다.
   *
   * 살아 있는지는 wallet 에 물어서 정한다 — 우리 표식은 어느 결제를 물어볼지만 가리킨다.
   * 물어보지 못하면(네트워크 실패) 예외가 그대로 나간다: 「못 물어봤다」를 「없다」로 읽으면
   * 바로 그 이중 결제가 된다. 고객에겐 잠시 뒤 다시 누르는 편이 낫다.
   */
  private async findReusableIntentId(userId: string, arrearsIds: string[], amount: number): Promise<string | null> {
    const { intentIds, unmarked } = await this.arrearsReader.pendingIntentMarks(userId);
    // 표식 없는 줄이 있거나(결제 뒤에 미수가 더 생겼다) 표식이 여럿이면 그 결제는 지금 청구할
    // 금액을 덮지 않는다. 부분 청산은 허용하지 않으므로 재사용하지 않고 새로 만든다.
    if (unmarked > 0 || intentIds.length !== 1) return null;

    const intent = await this.paymentClientService.getWalletPaymentIntentOrNull(intentIds[0]);
    if (!intent) return null;
    if (!REUSABLE_INTENT_STATUSES.has(intent.status)) return null;
    // 만료 크론은 10분마다 돌므로 만료 시각이 지났어도 상태가 아직 안 바뀐 창이 있다.
    if (intent.expiresAt && new Date(intent.expiresAt).getTime() <= Date.now()) return null;
    if (!isArrearsPayment(intent.metadata)) return null;
    if (intent.metadata?.userId !== userId) return null;
    // 금액·대상이 하나라도 다르면 그 결제로는 빚이 안 지워진다(관리자가 금액을 고친 경우 등).
    if (intent.payableAmount !== amount) return null;
    if (!sameIdSet(arrearsIdsFromMetadata(intent.metadata), arrearsIds)) return null;

    return intent.id;
  }

  /**
   * 사람이 수습해야 하는 청산을 계약 이벤트로 남긴다.
   *
   * 대상 줄이 여러 계약에 걸칠 수 있어 하나를 골라 붙인다 — **가장 오래된 줄의 계약**이다
   * (`lockSettlementTargets` 가 발생 순으로 돌려준다). 고른 규칙이 없으면 같은 사고가 매번 다른
   * 계약에 붙어 이력이 흩어진다. 나머지 계약은 payload 에 전부 싣는다.
   */
  private async recordSettlementMismatch(
    tx: DrizzleTransaction,
    params: {
      targets: SettlementTargetRow[];
      userId: string;
      intentId: string;
      paid: number;
      due: number;
      reason: 'UNDERPAID' | 'OVERPAID' | 'NO_OPEN_ARREARS';
    },
  ): Promise<void> {
    const contractId = params.targets[0]?.contractId;
    if (!contractId) {
      // 지목된 줄이 하나도 없다(남의 id·지워진 id). 붙일 계약이 없어 로그가 유일한 흔적이다.
      this.logger.error(
        `[arrears] 청산 대상 줄을 찾지 못했다 — 계약 이벤트를 남길 수 없다 ` +
          `(intentId=${params.intentId}, userId=${params.userId}, paid=${params.paid})`,
      );
      return;
    }

    await this.contractEventManager.addEvent(
      tx,
      contractId,
      ARREARS_SETTLEMENT_MISMATCH,
      {
        reason: params.reason,
        intentId: params.intentId,
        paid: params.paid,
        due: params.due,
        arrearsIds: params.targets.map((t) => t.id),
        contractIds: [...new Set(params.targets.map((t) => t.contractId))],
      },
      'SYSTEM',
      params.userId,
    );
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

    const paid = intent.payableAmount;
    const settlementRef = `intent:${intentId}`;
    const settled = await this.dbService.db.transaction(async (tx) => {
      // 받은 돈으로 지울 빚을 덮는지 먼저 본다. 결제를 만든 뒤 입금이 확인되기까지 관리자가 금액을
      // 조정하거나 면제할 수 있어서, 대조 없이 닫으면 «덜 받고 전액 탕감» 이 조용히 일어난다.
      const targets = await this.arrearsManager.lockSettlementTargets(tx, userId, arrearsIds);
      const due = targets.filter((t) => t.status === 'OUTSTANDING').reduce((sum, t) => sum + t.amount, 0);

      if (due === 0) {
        // 이 결제가 이미 닫은 줄이면 같은 이벤트의 재배달이다 — 정상이고 흔하다.
        if (targets.some((t) => t.settlementRef === settlementRef)) return [];

        // 그게 아니면 돈은 들어왔는데 지울 빚이 없다(결제 «전»에 면제된 경우 등). 사람이 환불해야 한다.
        this.logger.error(
          `[arrears] 지울 미수가 없는데 입금됐다 — 수동 확인 필요 ` +
            `(intentId=${intentId}, userId=${userId}, paid=${paid}, ids=${arrearsIds.join(',')})`,
        );
        await this.recordSettlementMismatch(tx, { targets, userId, intentId, paid, due, reason: 'NO_OPEN_ARREARS' });
        return [];
      }

      if (paid < due) {
        this.logger.error(
          `[arrears] 수납액이 미수보다 적어 청산하지 않는다 — 수동 확인 필요 ` +
            `(intentId=${intentId}, userId=${userId}, paid=${paid}, due=${due})`,
        );
        await this.recordSettlementMismatch(tx, { targets, userId, intentId, paid, due, reason: 'UNDERPAID' });
        return [];
      }
      if (paid > due) {
        this.logger.warn(
          `[arrears] 수납액이 미수보다 많다 — 청산은 진행하고 차액은 사람이 본다 ` +
            `(intentId=${intentId}, userId=${userId}, paid=${paid}, due=${due})`,
        );
        await this.recordSettlementMismatch(tx, { targets, userId, intentId, paid, due, reason: 'OVERPAID' });
      }

      return this.arrearsManager.settleMany(tx, userId, arrearsIds, settlementRef);
    });

    if (settled.length === arrearsIds.length) {
      this.logger.log(`[arrears] 청산 완료: userId=${userId}, intentId=${intentId}, count=${settled.length}`);
      return;
    }

    // 0건은 위 트랜잭션이 이미 갈라 놨다 — 재배달(정상)이면 조용히, 지울 빚이 없는데 입금됐으면
    // 계약 이벤트까지 남겼다. 여기서 다시 적으면 정상 재배달마다 경고가 쌓인다.
    if (settled.length === 0) return;

    this.logger.error(
      `[arrears] 부분 청산 — 결제는 전액인데 일부만 닫혔다. 수동 확인 필요 ` +
        `(intentId=${intentId}, userId=${userId}, 요청=${arrearsIds.length}, 청산=${settled.length})`,
    );
  }
}
