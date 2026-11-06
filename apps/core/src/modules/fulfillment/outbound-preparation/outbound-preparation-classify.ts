import { compatibleShippingProfileId } from '../services/shipping-profile';

export type PreparationBucket = 'ready' | 'partial' | 'unavailable' | 'mergeable' | 'resume' | 'needs_info';

export interface PreparationFacts {
  status: 'draft' | 'planned';
  hasActiveWorkItem: boolean;
  lines: { qty: number; confirmedQty: number }[];
  profileIds: (string | null)[];
  recipientComplete: boolean;
  consolidationPeerLines: PreparationFacts['lines'][];
}

export function classifyPreparation(f: PreparationFacts): PreparationBucket | null {
  if (f.hasActiveWorkItem) {
    return null;
  }

  if (f.status === 'planned') {
    return 'resume';
  }

  if (f.lines.every((line) => line.confirmedQty === 0)) {
    return 'unavailable';
  }

  if (f.lines.some((line) => line.confirmedQty < line.qty)) {
    return 'partial';
  }

  if (resolvePlanProfileId(f.profileIds) === null || !f.recipientComplete) {
    return 'needs_info';
  }

  if (
    f.consolidationPeerLines.some((lines) => lines.length > 0 && lines.every((line) => line.confirmedQty === line.qty))
  ) {
    return 'mergeable';
  }

  return 'ready';
}

export function resolvePlanProfileId(profileIds: (string | null)[]): string | null {
  return compatibleShippingProfileId(profileIds);
}

export function isSingleItem(lines: { qty: number }[]): boolean {
  return lines.length === 1;
}
