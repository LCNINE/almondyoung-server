'use client';

import { useQuery } from '@tanstack/react-query';
import { inventoryQueryKeys } from './query-keys';
import { inboundShipmentsClient } from '../../api/domains/inventory/inbound-shipments.client';
import type { InboundShipmentListFilter } from '../../types/dto/inbound-shipment';

export const useInboundShipments = (filter?: InboundShipmentListFilter) =>
  useQuery({
    queryKey: inventoryQueryKeys.inboundShipments(filter),
    queryFn: () => inboundShipmentsClient.list(filter),
  });

export const useInboundShipment = (id: string | undefined) =>
  useQuery({
    queryKey: inventoryQueryKeys.inboundShipment(id ?? ''),
    queryFn: () => inboundShipmentsClient.detail(id as string),
    enabled: !!id,
  });

export const useInboundShipmentBox = (id: string, boxId: string | undefined) =>
  useQuery({
    queryKey: inventoryQueryKeys.inboundShipmentBox(id, boxId ?? ''),
    queryFn: () => inboundShipmentsClient.getBox(id, boxId as string),
    enabled: !!boxId,
  });
