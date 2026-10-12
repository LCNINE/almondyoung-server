import { BadRequestError } from '@app/shared';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 키셋 커서 `ISO시각|uuid`. 정렬 키(진입 시각 또는 주문일)와 동률을 가르는 id. */
export function encodeCursor(at: Date, id: string): string {
  return `${at.toISOString()}|${id}`;
}

export function decodeCursor(cursor: string): { at: Date; id: string } {
  const sep = cursor.lastIndexOf('|');
  const at = new Date(cursor.slice(0, sep));
  const id = cursor.slice(sep + 1);
  if (sep < 0 || Number.isNaN(at.getTime()) || !UUID.test(id)) throw new BadRequestError('Invalid cursor');
  return { at, id };
}
