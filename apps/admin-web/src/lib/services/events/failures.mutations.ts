'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { eventQueryKeys } from './query-keys';
import { eventFailuresClient, type EventFailureService } from '../../api/domains/events';

/**
 * 성공·실패와 무관하게(onSettled) 그 서비스의 실패 쿼리를 전부 다시 읽는다.
 * 409(«이미 진행 중»·«이미 처리된 행»)는 화면이 낡았다는 뜻이라 실패 뒤에도 새로 읽어야 한다.
 */
function useInvalidateFailures(service: EventFailureService) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: eventQueryKeys.failures(service) });
}

export function useRedriveDeadLetter(service: EventFailureService) {
  const invalidate = useInvalidateFailures(service);
  return useMutation({
    mutationFn: (id: number) => eventFailuresClient.redrive(service, id),
    onSettled: invalidate,
  });
}

export function useDiscardDeadLetter(service: EventFailureService) {
  const invalidate = useInvalidateFailures(service);
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      eventFailuresClient.discardDeadLetter(service, id, reason),
    onSettled: invalidate,
  });
}

export function useRedriveAllDeadLetters(service: EventFailureService) {
  const invalidate = useInvalidateFailures(service);
  return useMutation({
    mutationFn: () => eventFailuresClient.redriveAll(service),
    onSettled: invalidate,
  });
}

export function useResendOutbox(service: EventFailureService) {
  const invalidate = useInvalidateFailures(service);
  return useMutation({
    mutationFn: (id: number) => eventFailuresClient.resend(service, id),
    onSettled: invalidate,
  });
}

export function useDiscardOutbox(service: EventFailureService) {
  const invalidate = useInvalidateFailures(service);
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      eventFailuresClient.discardOutbox(service, id, reason),
    onSettled: invalidate,
  });
}

export function useResendAllOutbox(service: EventFailureService) {
  const invalidate = useInvalidateFailures(service);
  return useMutation({
    mutationFn: () => eventFailuresClient.resendAll(service),
    onSettled: invalidate,
  });
}
