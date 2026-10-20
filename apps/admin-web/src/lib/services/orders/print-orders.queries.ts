'use client';

import { isAxiosError } from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { printOrderServerMessageCopy } from './print-order-error-copy';
import {
  printOrdersClient,
  type PrintOrderTab,
} from '@/lib/api/domains/orders/print-orders.client';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';

export const printOrderKeys = {
  all: ['print-orders'] as const,
  summary: ['print-orders', 'summary'] as const,
  list: (tab: PrintOrderTab, q: string, page: number) =>
    ['print-orders', 'list', tab, q, page] as const,
  byLine: (lineId: string) => ['print-orders', 'by-line', lineId] as const,
  byDesign: (designId: string) =>
    ['print-orders', 'by-design', designId] as const,
};

export function printOrderErrorMessage(error: unknown): string {
  if (isAxiosError(error)) {
    const data: unknown = error.response?.data;
    const raw =
      typeof data === 'object' && data !== null && 'message' in data
        ? data.message
        : undefined;
    const message = Array.isArray(raw) ? raw.join(', ') : raw;
    if (typeof message === 'string') {
      return printOrderServerMessageCopy(message);
    }
  }
  return error instanceof Error ? error.message : '요청을 처리하지 못했습니다.';
}

export function usePrintOrderSummary() {
  return useQuery({
    queryKey: printOrderKeys.summary,
    queryFn: () => printOrdersClient.summary(),
    refetchInterval: 60_000,
  });
}

export function usePrintOrders(tab: PrintOrderTab, q: string, page = 1) {
  return useQuery({
    queryKey: printOrderKeys.list(tab, q, page),
    queryFn: () => printOrdersClient.list({ tab, q: q || undefined, page }),
    refetchInterval: 60_000,
  });
}

export function usePrintOrderByLine(lineId: string | undefined) {
  return useQuery({
    queryKey: printOrderKeys.byLine(lineId ?? ''),
    queryFn: () => printOrdersClient.byLine(lineId ?? ''),
    enabled: !!lineId,
  });
}

export function usePrintOrdersByDesign(designId: string | undefined) {
  return useQuery({
    queryKey: printOrderKeys.byDesign(designId ?? ''),
    queryFn: () => printOrdersClient.byDesign(designId ?? ''),
    enabled: !!designId,
  });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: printOrderKeys.all });
}

export function useRetryPrintOrder() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (v: { id: string; confirmNoWowpressOrder: boolean }) =>
      printOrdersClient.retry(v.id, v.confirmNoWowpressOrder),
    onSuccess: invalidate,
  });
}
useRetryPrintOrder.permission = ['order.order.write'] as const satisfies PermissionRequirement;

export function useConfirmTestPrintOrder() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (v: { id: string; note: string }) =>
      printOrdersClient.confirmTest(v.id, v.note),
    onSuccess: invalidate,
  });
}
useConfirmTestPrintOrder.permission = ['order.order.write'] as const satisfies PermissionRequirement;

export function useResolveCancelPrintOrder() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (v: { id: string; outcome: 'cancelled' | 'proceed' }) =>
      printOrdersClient.resolveCancel(v.id, v.outcome),
    onSuccess: invalidate,
  });
}
useResolveCancelPrintOrder.permission = ['order.order.write'] as const satisfies PermissionRequirement;
