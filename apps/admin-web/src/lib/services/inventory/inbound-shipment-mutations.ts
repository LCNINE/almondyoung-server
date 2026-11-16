'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryQueryKeys } from './query-keys';
import { inboundShipmentsClient } from '../../api/domains/inventory/inbound-shipments.client';
import {
  INBOUND_SHIPMENT_LIST_CONTEXT_ID,
  uploadFileToFileService,
} from '../../api/domains/files/upload.client';
import {
  runInboundShipmentUpload,
  type InboundShipmentUploadInput,
} from '@/features/inventory/inbound-shipments/lib/upload-flow';
import type {
  ConfirmInboundShipmentBody,
  EditInboundShipmentBoxBody,
  EditInboundShipmentLineBody,
  UpdateInboundShipmentHeaderBody,
} from '../../types/dto/inbound-shipment';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';

/** 성공 시 목록과(있으면) 그 선적 상세를 새로 받는다. */
function useInvalidateShipments() {
  const queryClient = useQueryClient();
  return (id?: string) => {
    queryClient.invalidateQueries({
      queryKey: inventoryQueryKeys.inboundShipmentsRoot,
    });
    if (id)
      queryClient.invalidateQueries({
        queryKey: inventoryQueryKeys.inboundShipment(id),
      });
  };
}

export const useUploadInboundShipment = () => {
  const invalidate = useInvalidateShipments();
  return useMutation({
    mutationFn: (input: InboundShipmentUploadInput) =>
      runInboundShipmentUpload(input, {
        uploadOriginal: (file) =>
          uploadFileToFileService(file, {
            contextId: INBOUND_SHIPMENT_LIST_CONTEXT_ID,
            isPublic: false,
            compress: false,
          }),
        createDraft: (body) => inboundShipmentsClient.upload(body),
      }),
    onSuccess: (data) => invalidate(data.shipmentId),
  });
};
useUploadInboundShipment.permission = [
  'inventory.inbound_shipment.write',
] as const satisfies PermissionRequirement;

export const useUpdateInboundShipmentHeader = () => {
  const invalidate = useInvalidateShipments();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: { id: string } & UpdateInboundShipmentHeaderBody) =>
      inboundShipmentsClient.updateHeader(id, body),
    onSuccess: (_d, vars) => invalidate(vars.id),
  });
};
useUpdateInboundShipmentHeader.permission = [
  'inventory.inbound_shipment.write',
] as const satisfies PermissionRequirement;

export const useEditInboundShipmentLine = () => {
  const invalidate = useInvalidateShipments();
  return useMutation({
    mutationFn: ({
      id,
      lineId,
      ...body
    }: { id: string; lineId: string } & EditInboundShipmentLineBody) =>
      inboundShipmentsClient.editLine(id, lineId, body),
    onSuccess: (_d, vars) => invalidate(vars.id),
  });
};
useEditInboundShipmentLine.permission = [
  'inventory.inbound_shipment.write',
] as const satisfies PermissionRequirement;

export const useEditInboundShipmentBox = () => {
  const invalidate = useInvalidateShipments();
  return useMutation({
    mutationFn: ({
      id,
      boxId,
      ...body
    }: { id: string; boxId: string } & EditInboundShipmentBoxBody) =>
      inboundShipmentsClient.editBox(id, boxId, body),
    onSuccess: (_d, vars) => invalidate(vars.id),
  });
};
useEditInboundShipmentBox.permission = [
  'inventory.inbound_shipment.write',
] as const satisfies PermissionRequirement;

export const useConfirmInboundShipment = () => {
  const invalidate = useInvalidateShipments();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: { id: string } & ConfirmInboundShipmentBody) =>
      inboundShipmentsClient.confirm(id, body),
    onSuccess: (_d, vars) => invalidate(vars.id),
  });
};
useConfirmInboundShipment.permission = [
  'inventory.inbound_shipment.write',
] as const satisfies PermissionRequirement;

export const useCancelInboundShipment = () => {
  const invalidate = useInvalidateShipments();
  return useMutation({
    mutationFn: (id: string) => inboundShipmentsClient.cancel(id),
    onSuccess: (_d, id) => invalidate(id),
  });
};
useCancelInboundShipment.permission = [
  'inventory.inbound_shipment.write',
] as const satisfies PermissionRequirement;

export const useCloseInboundShipment = () => {
  const invalidate = useInvalidateShipments();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      inboundShipmentsClient.close(id, { reason }),
    onSuccess: (_d, vars) => invalidate(vars.id),
  });
};
useCloseInboundShipment.permission = [
  'inventory.inbound_shipment.write',
] as const satisfies PermissionRequirement;

export const useReopenInboundShipment = () => {
  const invalidate = useInvalidateShipments();
  return useMutation({
    mutationFn: (id: string) => inboundShipmentsClient.reopen(id),
    onSuccess: (_d, id) => invalidate(id),
  });
};
useReopenInboundShipment.permission = [
  'inventory.inbound_shipment.write',
] as const satisfies PermissionRequirement;
