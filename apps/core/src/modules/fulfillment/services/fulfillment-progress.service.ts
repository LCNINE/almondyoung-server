import { BadRequestException, Injectable } from '@nestjs/common';

export const FULFILLMENT_PROGRESS_STATUSES = [
  'created',
  'partially_reserved',
  'ready',
  'processing',
  'partially_shipped',
  'completed',
  'canceled',
  'recovery_required',
] as const;

export type FulfillmentProgressStatus = (typeof FULFILLMENT_PROGRESS_STATUSES)[number];

export interface FulfillmentOrderItemProgressInput {
  id: string;
  qty: number;
  shippedQty: number;
  canceledQty: number;
  confirmedReservedQty: number;
  /** Active Draft/Planned/recovery shipment-line demand. */
  activeLineQty: number;
  /** Picking, packing or inspection has begun for the outstanding demand. */
  processing: boolean;
  recoveryRequired: boolean;
}

export interface FulfillmentOrderItemProgress extends FulfillmentOrderItemProgressInput {
  outstandingQty: number;
  status: FulfillmentProgressStatus;
}

export interface FulfillmentOrderProgress {
  status: FulfillmentProgressStatus;
  totalQty: number;
  shippedQty: number;
  canceledQty: number;
  outstandingQty: number;
  confirmedReservedQty: number;
  items: FulfillmentOrderItemProgress[];
}

function assertNonNegativeInteger(name: string, value: number, itemId: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new BadRequestException(`FOI ${itemId} ${name} must be a non-negative safe integer`);
  }
}

/**
 * Pure demand-settlement projection. Delivery/tracking state is deliberately absent
 * from the input so a delivered webhook can never change FO progress.
 */
export function projectFulfillmentOrderItemProgress(
  input: FulfillmentOrderItemProgressInput,
): FulfillmentOrderItemProgress {
  assertNonNegativeInteger('qty', input.qty, input.id);
  assertNonNegativeInteger('shippedQty', input.shippedQty, input.id);
  assertNonNegativeInteger('canceledQty', input.canceledQty, input.id);
  assertNonNegativeInteger('confirmedReservedQty', input.confirmedReservedQty, input.id);
  assertNonNegativeInteger('activeLineQty', input.activeLineQty, input.id);
  if (input.qty === 0) {
    throw new BadRequestException(`FOI ${input.id} qty must be positive`);
  }

  const settledQty = input.shippedQty + input.canceledQty;
  if (settledQty > input.qty) {
    throw new BadRequestException(`FOI ${input.id} settled quantity ${settledQty} exceeds qty ${input.qty}`);
  }
  const outstandingQty = input.qty - settledQty;

  let status: FulfillmentProgressStatus;
  if (input.recoveryRequired) {
    status = 'recovery_required';
  } else if (outstandingQty === 0) {
    // shipped+canceled=qty is demand completion; canceled is its all-canceled specialization.
    status = input.canceledQty === input.qty ? 'canceled' : 'completed';
  } else if (input.shippedQty > 0) {
    status = 'partially_shipped';
  } else if (input.processing) {
    status = 'processing';
  } else if (input.confirmedReservedQty >= outstandingQty) {
    status = 'ready';
  } else if (input.confirmedReservedQty > 0) {
    status = 'partially_reserved';
  } else {
    status = 'created';
  }

  return { ...input, outstandingQty, status };
}

export function projectFulfillmentOrderProgress(
  inputs: readonly FulfillmentOrderItemProgressInput[],
): FulfillmentOrderProgress {
  if (inputs.length === 0) {
    throw new BadRequestException('Fulfillment order progress requires at least one item');
  }
  const items = inputs.map(projectFulfillmentOrderItemProgress);
  const summary = items.reduce(
    (acc, item) => ({
      totalQty: acc.totalQty + item.qty,
      shippedQty: acc.shippedQty + item.shippedQty,
      canceledQty: acc.canceledQty + item.canceledQty,
      outstandingQty: acc.outstandingQty + item.outstandingQty,
      confirmedReservedQty: acc.confirmedReservedQty + item.confirmedReservedQty,
    }),
    { totalQty: 0, shippedQty: 0, canceledQty: 0, outstandingQty: 0, confirmedReservedQty: 0 },
  );

  let status: FulfillmentProgressStatus;
  if (items.some((item) => item.status === 'recovery_required')) {
    status = 'recovery_required';
  } else if (summary.outstandingQty === 0) {
    status = summary.canceledQty === summary.totalQty ? 'canceled' : 'completed';
  } else if (summary.shippedQty > 0) {
    status = 'partially_shipped';
  } else if (items.some((item) => item.status === 'processing')) {
    status = 'processing';
  } else if (summary.confirmedReservedQty >= summary.outstandingQty) {
    status = 'ready';
  } else if (summary.confirmedReservedQty > 0) {
    status = 'partially_reserved';
  } else {
    status = 'created';
  }

  return { status, ...summary, items };
}

@Injectable()
export class FulfillmentProgressService {
  projectItem(input: FulfillmentOrderItemProgressInput): FulfillmentOrderItemProgress {
    return projectFulfillmentOrderItemProgress(input);
  }

  projectOrder(inputs: readonly FulfillmentOrderItemProgressInput[]): FulfillmentOrderProgress {
    return projectFulfillmentOrderProgress(inputs);
  }
}
