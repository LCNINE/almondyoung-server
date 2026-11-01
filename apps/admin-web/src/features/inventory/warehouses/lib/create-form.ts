import type { CreateWarehouseDto, WarehouseDto } from '@/lib/types/dto/inventory';

export type CreateWarehouseFormState = {
  name: string;
  type: WarehouseDto['type'];
  location: string;
};

export type CreateWarehousePayloadResult =
  | { ok: true; payload: CreateWarehouseDto }
  | { ok: false; error: string };

export function emptyCreateWarehouseForm(): CreateWarehouseFormState {
  return { name: '', type: 'domestic', location: '' };
}

export function toCreateWarehousePayload(form: CreateWarehouseFormState): CreateWarehousePayloadResult {
  const name = form.name.trim();
  if (!name) return { ok: false, error: '창고 이름을 입력하세요.' };
  const location = form.location.trim();
  return {
    ok: true,
    payload: { name, type: form.type, ...(location ? { location } : {}) },
  };
}
