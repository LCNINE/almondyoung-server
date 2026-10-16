'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { attendanceApi } from '@/lib/api/domains/attendance';
import { toast } from 'sonner';

export const ATTENDANCE_KEY = ['attendance'] as const;
export function useAttendance() {
  return useQuery({
    queryKey: [...ATTENDANCE_KEY, 'me'],
    queryFn: attendanceApi.me,
    refetchInterval: 30000,
  });
}

export function useAttendanceAction<T>(
  action: (input: T) => Promise<unknown>,
  success?: string
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: action,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ATTENDANCE_KEY });

      if (success) {
        toast.success(success);
      }
    },
    onError: (error) => toast.error(attendanceError(error)),
  });
}

export function attendanceError(error: unknown): string {
  const candidate = error as {
    response?: { data?: { message?: string | string[] } };
    message?: string;
  };
  const message = candidate.response?.data?.message;

  return Array.isArray(message)
    ? message.join(' ')
    : message || candidate.message || '잠시 후 다시 시도해 주세요.';
}
