import { Injectable } from '@nestjs/common';
import { BadRequestError, NotFoundError } from '@app/shared';
import { DbService, InjectTypedDb } from '@app/db';
import { eq } from 'drizzle-orm';
import { wmsSchema, wmsTables, type DbTx } from '../../inventory/schema/inventory.schema';
import { ConfirmCarrierTrackingDto, CarrierTrackingConfirmResultDto } from './dto/carrier-tracking.dto';
import { FulfillmentCommandService } from '../services/fulfillment-command.service';
import { FulfillmentWorkflowGate } from '../services/fulfillment-workflow-gate.service';
import { CarrierTrackingChecker } from './carrier-tracking.checker';
import {
  CarrierNotTrackableError,
  CarrierTrackingChangedError,
  CarrierTrackingNotNeededError,
} from './carrier-tracking.errors';
import { attentionFamily, confirmationResumeAt } from './carrier-tracking.judge';
import { CarrierTrackingReader } from './carrier-tracking.reader';

@Injectable()
export class CarrierTrackingManager {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly reader: CarrierTrackingReader,
    private readonly checker: CarrierTrackingChecker,
    private readonly commands: FulfillmentCommandService,
    private readonly workflowGate: FulfillmentWorkflowGate,
  ) {}

  /** 택배사에 지금 한 번 더 묻는다. 묻지 못한 것도 기록에 남으므로 실패로 던지지 않는다. */
  async recheck(dispatchAttemptId: string): Promise<string> {
    this.workflowGate.assertV2MutationAllowed('shipment.tracking.record');
    const attempt = await this.reader.findAttempt(dispatchAttemptId, new Date());
    if (!attempt) throw new NotFoundError(`Dispatch attempt not found: ${dispatchAttemptId}`);
    if (
      !this.checker.trackableCarriers().includes(attempt.carrier) ||
      (attempt.attemptStatus !== 'dispatched' && attempt.attemptStatus !== 'recalled')
    ) {
      throw new CarrierNotTrackableError(dispatchAttemptId);
    }
    await this.checker.check({
      dispatchAttemptId,
      dispatchedAt: attempt.dispatchedAt,
      carrier: attempt.carrier,
      trackingNo: attempt.trackingNo,
      recalled: attempt.attemptStatus === 'recalled',
    });
    return attempt.shipmentId;
  }

  /** 사람이 택배사에 확인한 것을 남긴다. 화면이 본 상태와 같을 때만 받는다. */
  async confirm(
    dispatchAttemptId: string,
    dto: ConfirmCarrierTrackingDto,
    idempotencyKey: string,
    actorId: string,
    tx?: DbTx,
  ): Promise<CarrierTrackingConfirmResultDto> {
    this.workflowGate.assertV2MutationAllowed('shipment.tracking.confirm');
    const note = dto.note.trim();
    if (!note) throw new BadRequestError('note must contain a visible character');
    return this.commands.execute(
      {
        commandType: 'shipment.tracking.confirm',
        idempotencyKey,
        canonicalRequest: { actorId, dispatchAttemptId, ...dto, note },
      },
      async (trx) => {
        // 두 사람이 같은 송장을 동시에 적으면 나중 사람에게 앞 기록을 보이게 한다
        await trx
          .select({ id: wmsTables.dispatchAttempts.id })
          .from(wmsTables.dispatchAttempts)
          .where(eq(wmsTables.dispatchAttempts.id, dispatchAttemptId))
          .for('update');
        const now = new Date();
        const attempt = await this.reader.findAttempt(dispatchAttemptId, now, trx);
        if (!attempt) throw new NotFoundError(`Dispatch attempt not found: ${dispatchAttemptId}`);
        const { kind, scanKey } = attempt.judgement;
        if (kind === null) throw new CarrierTrackingNotNeededError(dispatchAttemptId);
        if (
          attentionFamily(kind) !== attentionFamily(dto.expectedKind) ||
          scanKey !== dto.expectedScanKey ||
          (attempt.confirmation?.id ?? null) !== (dto.expectedConfirmationId ?? null)
        ) {
          throw new CarrierTrackingChangedError(dispatchAttemptId);
        }
        const resumeAt = dto.outcome === 'wait' ? confirmationResumeAt(now) : null;
        const [created] = await trx
          .insert(wmsTables.carrierTrackingConfirmations)
          .values({ dispatchAttemptId, kind, scanKey, outcome: dto.outcome, resumeAt, note, actorId, createdAt: now })
          .returning({ id: wmsTables.carrierTrackingConfirmations.id });
        const response: CarrierTrackingConfirmResultDto = {
          confirmationId: created.id,
          resumeAt: resumeAt?.toISOString() ?? null,
        };
        return { response, resourceType: 'dispatch_attempt', resourceId: dispatchAttemptId };
      },
      tx,
    );
  }
}
