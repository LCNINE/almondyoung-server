import { ConflictException, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';

export type ReleaseEmptyShipmentTotesInput = {
  shipmentId: string;
  operationId: string;
};

export type ReleaseEmptyShipmentTotesResult = {
  releasedAssignmentIds: string[];
  retainedToteIds: string[];
};

@Injectable()
export class ToteLifecycleService {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async releaseEmptyAssignmentsForShipment(
    input: ReleaseEmptyShipmentTotesInput,
    tx?: DbTx,
  ): Promise<ReleaseEmptyShipmentTotesResult> {
    return this.dbService.run(async (trx) => {
      const assignments = await trx
        .select({
          assignmentId: wmsTables.shipmentToteAssignments.id,
          toteId: wmsTables.shipmentToteAssignments.toteId,
          toteBarcode: wmsTables.totes.barcode,
        })
        .from(wmsTables.shipmentToteAssignments)
        .innerJoin(wmsTables.totes, eq(wmsTables.totes.id, wmsTables.shipmentToteAssignments.toteId))
        .where(
          and(
            eq(wmsTables.shipmentToteAssignments.shipmentId, input.shipmentId),
            isNull(wmsTables.shipmentToteAssignments.releasedAt),
          ),
        )
        .orderBy(asc(wmsTables.totes.barcode));

      const releasedAssignmentIds: string[] = [];
      const retainedToteIds: string[] = [];
      for (const assignment of assignments) {
        await trx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`physical-tote:${assignment.toteBarcode}`}, 0))`,
        );
        const [tote] = await trx
          .select({ id: wmsTables.totes.id, status: wmsTables.totes.status, version: wmsTables.totes.version })
          .from(wmsTables.totes)
          .where(eq(wmsTables.totes.id, assignment.toteId))
          .limit(1)
          .for('update');
        if (!tote || tote.status !== 'in_use') {
          throw new ConflictException({
            code: 'TOTE_ASSIGNMENT_STATE_MISMATCH',
            message: `Active tote assignment ${assignment.assignmentId} has no in-use tote`,
          });
        }
        const activeAssignments = await trx
          .select({
            id: wmsTables.shipmentToteAssignments.id,
            shipmentId: wmsTables.shipmentToteAssignments.shipmentId,
          })
          .from(wmsTables.shipmentToteAssignments)
          .where(
            and(
              eq(wmsTables.shipmentToteAssignments.toteId, tote.id),
              isNull(wmsTables.shipmentToteAssignments.releasedAt),
            ),
          )
          .orderBy(asc(wmsTables.shipmentToteAssignments.id))
          .for('update');
        if (
          activeAssignments.length !== 1 ||
          activeAssignments[0].id !== assignment.assignmentId ||
          activeAssignments[0].shipmentId !== input.shipmentId
        ) {
          throw new ConflictException({
            code: 'TOTE_ASSIGNMENT_STALE',
            message: `Tote ${tote.id} assignment changed before operation ${input.operationId} could release it`,
          });
        }
        const positive = await trx
          .select({ id: wmsTables.batchInventorySessionBalances.id })
          .from(wmsTables.batchInventorySessionBalances)
          .where(
            and(
              eq(wmsTables.batchInventorySessionBalances.custodyType, 'TOTE'),
              eq(wmsTables.batchInventorySessionBalances.custodyRef, `tote:${tote.id}`),
              gt(wmsTables.batchInventorySessionBalances.qty, 0),
            ),
          )
          .limit(1)
          .for('update');
        if (positive.length) {
          retainedToteIds.push(tote.id);
          continue;
        }

        const [released] = await trx
          .update(wmsTables.shipmentToteAssignments)
          .set({ releasedAt: sql`now()` })
          .where(
            and(
              eq(wmsTables.shipmentToteAssignments.id, assignment.assignmentId),
              isNull(wmsTables.shipmentToteAssignments.releasedAt),
            ),
          )
          .returning({ id: wmsTables.shipmentToteAssignments.id });
        if (!released) {
          throw new ConflictException({
            code: 'TOTE_ASSIGNMENT_STALE',
            message: `Tote assignment ${assignment.assignmentId} changed while releasing`,
          });
        }
        const [available] = await trx
          .update(wmsTables.totes)
          .set({ status: 'available', version: tote.version + 1, updatedAt: sql`now()` })
          .where(
            and(
              eq(wmsTables.totes.id, tote.id),
              eq(wmsTables.totes.status, 'in_use'),
              eq(wmsTables.totes.version, tote.version),
            ),
          )
          .returning({ id: wmsTables.totes.id });
        if (!available) {
          throw new ConflictException({
            code: 'TOTE_STALE_VERSION',
            message: `Tote ${tote.id} changed while releasing operation ${input.operationId}`,
          });
        }
        releasedAssignmentIds.push(assignment.assignmentId);
      }
      return { releasedAssignmentIds, retainedToteIds };
    }, tx);
  }
}
