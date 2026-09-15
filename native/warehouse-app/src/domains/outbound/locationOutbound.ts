import { useMutation } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { ApiError } from '../../core/data/httpClient';
import {
  useCapabilityReader,
  usePermissionReader,
} from '../../core/operations/useWorkCapabilities';
import { validateOperationResult } from '../../core/operations/operationResult';
import type { LocationOutboundState } from './types';
export const outboundRemainingSignature = (state: LocationOutboundState) =>
  JSON.stringify(
    state.sources
      .filter((source) => source.remainingQty > 0)
      .map((source) => [
        source.shipmentLineId,
        source.sourceLocationId,
        source.remainingQty,
      ])
      .sort((a, b) => String(a).localeCompare(String(b)))
  );
export function useLocationOutbound() {
  const api = useApiClient();
  const readCapabilities = useCapabilityReader();
  const readPermissions = usePermissionReader();
  const read = async (shipmentId: string, warehouseId: string) => {
    const path = `/shipments/${shipmentId}/location-outbound-state?${new URLSearchParams({ warehouseId })}`;
    const state = await api.request<LocationOutboundState>({ path });
    validateOperationResult(path, state);
    if (state.warehouseId !== warehouseId || state.shipmentId !== shipmentId)
      throw new Error('출고 작업 범위를 확인해 주세요.');
    return state;
  };
  const start = useMutation({
    mutationFn: async (input: {
      shipmentId: string;
      warehouseId: string;
      idempotencyKey: string;
    }) => {
      if (!(await readCapabilities()).locationOutbound)
        throw new Error(
          '위치를 확인하는 출고를 사용하려면 서버 업데이트가 필요해요.'
        );
      return api.request<LocationOutboundState>({
        method: 'POST',
        path: `/shipments/${input.shipmentId}/location-outbound-starts`,
        body: { warehouseId: input.warehouseId },
        idempotencyKey: input.idempotencyKey,
      });
    },
  });
  const scan = useMutation({
    mutationFn: ({
      shipmentId,
      idempotencyKey,
      ...body
    }: {
      shipmentId: string;
      warehouseId: string;
      sourceLocationId: string;
      barcode: string;
      quantity: number;
      idempotencyKey: string;
    }) =>
      api.request<LocationOutboundState>({
        method: 'POST',
        path: `/shipments/${shipmentId}/location-outbound-scans`,
        body,
        idempotencyKey,
      }),
  });
  const force = useMutation({
    mutationFn: async ({
      shipmentId,
      idempotencyKey,
      ...body
    }: {
      shipmentId: string;
      warehouseId: string;
      reason: string;
      items: Array<{
        shipmentLineId: string;
        sourceLocationId: string;
        quantity: number;
      }>;
      idempotencyKey: string;
    }) => {
      // A failed or absent permission lookup must never create a durable write.
      let allowed = false;
      try {
        allowed = (await readPermissions()).forceDispatch === true;
      } catch {
        throw new ApiError(
          'Permission lookup failed',
          403,
          'LOCATION_OUTBOUND_FORCE_PERMISSION_UNAVAILABLE'
        );
      }
      if (!allowed)
        throw new ApiError(
          'Force permission required',
          403,
          'LOCATION_OUTBOUND_FORCE_PERMISSION_REQUIRED'
        );
      return api.request<LocationOutboundState>({
        method: 'POST',
        path: `/shipments/${shipmentId}/location-outbound-forces`,
        body,
        idempotencyKey,
      });
    },
  });
  return { read, start, scan, force };
}
