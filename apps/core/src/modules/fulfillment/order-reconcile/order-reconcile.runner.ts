// apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.runner.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, wmsSchema } from '../../inventory/schema/inventory.schema';
import { OrderReconcileRepository } from './order-reconcile.repository';
import { ORDER_RECONCILE_RULES, OrderReconcileRule } from './order-reconcile.rule';
import {
  RECONCILE_CANDIDATE_LIMIT,
  ReconcilePrior,
  ReconcileStep,
  chooseStep,
  effectivePrior,
  errorStep,
  nextRecord,
} from './order-reconcile.state';

export type RuleRunSummary = {
  rule: string;
  departed: number;
  acted: number;
  wouldAct: number;
  notNeeded: number;
  gaveUp: number;
  errors: number;
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * 리컨실러 한 바퀴(스펙 §4.3). 후보 하나 = savepoint 하나 — 한 주문의 실패가 다른 주문을 막지 않는다(#1016 1번 행의 교훈).
 * 규칙 하나가 통째로 실패하면 그 규칙만 건너뛴다.
 */
@Injectable()
export class OrderReconcileRunner {
  private readonly logger = new Logger(OrderReconcileRunner.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly repository: OrderReconcileRepository,
    @Inject(ORDER_RECONCILE_RULES) private readonly rules: OrderReconcileRule[],
  ) {}

  async runAll(now: Date): Promise<RuleRunSummary[]> {
    const out: RuleRunSummary[] = [];
    for (const rule of this.rules) {
      try {
        out.push(await this.runRule(rule, now));
      } catch (error) {
        this.logger.error(
          `order-reconcile rule ${rule.name} failed: ${messageOf(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
    return out;
  }

  async runRule(rule: OrderReconcileRule, now: Date, tx?: DbTx): Promise<RuleRunSummary> {
    const summary: RuleRunSummary = {
      rule: rule.name,
      departed: await this.repository.deleteDeparted(rule, tx),
      acted: 0,
      wouldAct: 0,
      notNeeded: 0,
      gaveUp: 0,
      errors: 0,
    };
    const candidates = await this.repository.candidates(rule, now, RECONCILE_CANDIDATE_LIMIT, tx);
    for (const candidate of candidates) {
      const step = await this.reconcileOne(rule, candidate.salesOrderId, candidate.prior, now, tx);
      if (step === 'act') summary.acted++;
      else if (step === 'would_act') summary.wouldAct++;
      else if (step === 'not_needed') summary.notNeeded++;
      else if (step === 'give_up') summary.gaveUp++;
      else summary.errors++;
    }
    const touched =
      summary.departed + summary.acted + summary.wouldAct + summary.notNeeded + summary.gaveUp + summary.errors;
    if (touched > 0) {
      this.logger.log(
        `order-reconcile ${rule.name}(#${rule.row}, ${rule.mode}): acted=${summary.acted} would_act=${summary.wouldAct} ` +
          `not_needed=${summary.notNeeded} gave_up=${summary.gaveUp} error=${summary.errors} departed=${summary.departed}`,
      );
    }
    return summary;
  }

  private async reconcileOne(
    rule: OrderReconcileRule,
    salesOrderId: string,
    prior: ReconcilePrior | null,
    now: Date,
    tx?: DbTx,
  ): Promise<ReconcileStep | 'error'> {
    // savepoint 가 롤백돼도 이번 바퀴에 구한 지문은 남긴다 — 이전 지문으로 세면 운영자가 원인을 고친 뒤에도 리셋되지 않는다
    let seen: string | undefined;
    try {
      return await this.dbService.run(
        (trx) =>
          trx.transaction(async (sp) => {
            const fingerprint = await rule.fingerprint(salesOrderId, sp);
            seen = fingerprint;
            const eff = effectivePrior(prior, fingerprint, rule.mode);
            const step = chooseStep(eff, rule.mode, await rule.check(salesOrderId, sp));
            if (step === 'act') await rule.act(salesOrderId, sp);
            if (step === 'would_act' && (prior?.lastResult !== 'would_act' || prior.fingerprint !== fingerprint)) {
              // 관찰 기록은 처음 볼 때만 로그 — 매분 같은 줄이 쌓이지 않게
              this.logger.log(`order-reconcile ${rule.name} would act on sales order ${salesOrderId}`);
            }
            await this.repository.save(
              rule,
              salesOrderId,
              nextRecord(eff, { fingerprint, mode: rule.mode, step, outcome: step === 'act' ? 'acted' : undefined }, now),
              now,
              sp,
            );
            return step;
          }),
        tx,
      );
    } catch (error) {
      // 지문을 못 구했으면 이전 지문으로 센다 — 같은 예외가 매분 반복돼도 백오프·포기가 걸리게
      const fingerprint = seen ?? prior?.fingerprint ?? '';
      const eff = effectivePrior(prior, fingerprint, rule.mode);
      const step = errorStep(eff, rule.mode);
      const record = nextRecord(
        eff,
        {
          fingerprint,
          mode: rule.mode,
          step,
          outcome: step === 'act' ? 'error' : undefined,
          error: messageOf(error),
        },
        now,
      );
      await this.dbService.run((trx) => this.repository.save(rule, salesOrderId, record, now, trx), tx);
      this.logger.warn(`order-reconcile ${rule.name} failed on sales order ${salesOrderId}: ${messageOf(error)}`);
      return 'error';
    }
  }
}
