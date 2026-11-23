import { REQUIRED_RECIPIENT_FIELDS } from '../waybill/waybill-request.assembler';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

export function missingRecipientFields(snapshot: unknown): string[] {
  const recipient = isRecord(snapshot) ? snapshot : {};

  return REQUIRED_RECIPIENT_FIELDS.filter((key) => {
    const value = recipient[key];

    return typeof value !== 'string' || !value.trim();
  });
}

export function isRecipientComplete(snapshot: unknown): boolean {
  return missingRecipientFields(snapshot).length === 0;
}

export function recipientNameOf(snapshot: unknown): string | null {
  const name = isRecord(snapshot) ? snapshot.recipientName : undefined;

  return typeof name === 'string' && name.trim() ? name.trim() : null;
}
