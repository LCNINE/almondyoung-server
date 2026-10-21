'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { attendanceWageApi } from '@/lib/api/domains/attendance';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';
import { attendanceError } from './use-attendance';

export const WAGE_KEY = ['attendance', 'wage'] as const;

export const wageKeys = {
  groups: () => [...WAGE_KEY, 'groups'] as const,
  decisionGroups: () => [...WAGE_KEY, 'decision-groups'] as const,
  policies: (groupId: string) => [...WAGE_KEY, 'policies', groupId] as const,
  workers: () => [...WAGE_KEY, 'workers'] as const,
  worker: (userId: string) => [...WAGE_KEY, 'worker', userId] as const,
  minimumWages: () => [...WAGE_KEY, 'minimum-wages'] as const,
  decisions: (groupId: string, month: string) =>
    [...WAGE_KEY, 'decisions', groupId, month] as const,
  preview: (groupId: string, month: string) =>
    [...WAGE_KEY, 'preview', groupId, month] as const,
  settlements: (groupId: string) =>
    [...WAGE_KEY, 'settlements', groupId] as const,
  mine: (month: string) => [...WAGE_KEY, 'mine', month] as const,
};

/** 급여 그룹 목록. 판정 화면은 판정 권한으로 열리는 목록을 쓴다(급여 조회 권한이 없어도 된다). */
export function usePayGroups(source: 'wage' | 'decisions' = 'wage') {
  return useQuery({
    queryKey: source === 'wage' ? wageKeys.groups() : wageKeys.decisionGroups(),
    queryFn:
      source === 'wage'
        ? attendanceWageApi.groups
        : attendanceWageApi.decisionGroups,
  });
}

export function usePayPolicies(groupId: string | null) {
  return useQuery({
    queryKey: wageKeys.policies(groupId ?? ''),
    queryFn: () => attendanceWageApi.policies(groupId ?? ''),
    enabled: !!groupId,
  });
}

export function useWageWorkers() {
  return useQuery({
    queryKey: wageKeys.workers(),
    queryFn: attendanceWageApi.workers,
  });
}

export function useWageWorker(userId: string) {
  return useQuery({
    queryKey: wageKeys.worker(userId),
    queryFn: () => attendanceWageApi.worker(userId),
  });
}

export function useMinimumWages() {
  return useQuery({
    queryKey: wageKeys.minimumWages(),
    queryFn: attendanceWageApi.minimumWages,
  });
}

export function useWageDecisions(groupId: string | null, month: string) {
  return useQuery({
    queryKey: wageKeys.decisions(groupId ?? '', month),
    queryFn: () => attendanceWageApi.decisions(groupId ?? '', month),
    enabled: !!groupId,
  });
}

export function useSettlementPreview(groupId: string | null, month: string) {
  return useQuery({
    queryKey: wageKeys.preview(groupId ?? '', month),
    queryFn: () => attendanceWageApi.preview(groupId ?? '', month),
    enabled: !!groupId,
  });
}

export function useSettlements(groupId: string | null) {
  return useQuery({
    queryKey: wageKeys.settlements(groupId ?? ''),
    queryFn: () => attendanceWageApi.settlements(groupId ?? ''),
    enabled: !!groupId,
  });
}

export function useSettlement(id: string | null) {
  return useQuery({
    queryKey: [...WAGE_KEY, 'settlement', id ?? ''],
    queryFn: () => attendanceWageApi.settlement(id ?? ''),
    enabled: !!id,
  });
}

export function useMyWage(month: string) {
  return useQuery({
    queryKey: wageKeys.mine(month),
    queryFn: () => attendanceWageApi.mine(month),
  });
}

/** 급여 쓰기는 결과가 서로 얽힌다(시급 → 미리보기, 판정 → 정산) — 급여 조회를 통째로 다시 읽는다. */
function useWageMutation<T, R>(
  action: (input: T) => Promise<R>,
  success?: string
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: action,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: WAGE_KEY });

      if (success) {
        toast.success(success);
      }
    },
    onError: (error) => toast.error(attendanceError(error)),
  });
}

export const useCreatePayGroup = () =>
  useWageMutation(attendanceWageApi.createGroup, '급여 그룹을 만들었어요.');
useCreatePayGroup.permission = [
  'attendance.wage.write',
] as const satisfies PermissionRequirement;

export const useUpdatePayGroup = () =>
  useWageMutation(attendanceWageApi.updateGroup, '급여 그룹을 저장했어요.');
useUpdatePayGroup.permission = [
  'attendance.wage.write',
] as const satisfies PermissionRequirement;

export const useAddPayPolicy = () =>
  useWageMutation(attendanceWageApi.addPolicy, '계산 규칙을 저장했어요.');
useAddPayPolicy.permission = [
  'attendance.wage.write',
] as const satisfies PermissionRequirement;

export const useSaveWageWorker = () =>
  useWageMutation(attendanceWageApi.saveWorker, '근무자 정보를 저장했어요.');
useSaveWageWorker.permission = [
  'attendance.wage.write',
] as const satisfies PermissionRequirement;

export const useAddWageRate = () =>
  useWageMutation(attendanceWageApi.addRate, '시급을 추가했어요.');
useAddWageRate.permission = [
  'attendance.wage.write',
] as const satisfies PermissionRequirement;

export const useAddWorkSchedule = () =>
  useWageMutation(attendanceWageApi.addSchedule, '근무 시간표를 추가했어요.');
useAddWorkSchedule.permission = [
  'attendance.wage.write',
] as const satisfies PermissionRequirement;

export const useAddMinimumWage = () =>
  useWageMutation(attendanceWageApi.addMinimumWage, '최저임금을 추가했어요.');
useAddMinimumWage.permission = [
  'attendance.wage.write',
] as const satisfies PermissionRequirement;

export const useConfirmSettlement = () =>
  useWageMutation(attendanceWageApi.confirm, '정산을 확정했어요.');
useConfirmSettlement.permission = [
  'attendance.wage.write',
] as const satisfies PermissionRequirement;

export const useReopenSettlement = () =>
  useWageMutation(attendanceWageApi.reopen, '정산을 다시 열었어요.');
useReopenSettlement.permission = [
  'attendance.wage.write',
] as const satisfies PermissionRequirement;

export const useDecideOvertime = () =>
  useWageMutation(attendanceWageApi.decideOvertime);
useDecideOvertime.permission = [
  'attendance.request.review',
] as const satisfies PermissionRequirement;

export const useDecideAbsence = () =>
  useWageMutation(attendanceWageApi.decideAbsence);
useDecideAbsence.permission = [
  'attendance.request.review',
] as const satisfies PermissionRequirement;

export const useDeletePayGroup = () =>
  useWageMutation(attendanceWageApi.deleteGroup, '급여 그룹을 지웠어요.');
useDeletePayGroup.permission = [
  'attendance.wage.write',
] as const satisfies PermissionRequirement;

export const useUpdatePayPolicy = () =>
  useWageMutation(attendanceWageApi.updatePolicy, '계산 규칙을 고쳤어요.');
useUpdatePayPolicy.permission = [
  'attendance.wage.write',
] as const satisfies PermissionRequirement;

export const useDeletePayPolicy = () =>
  useWageMutation(attendanceWageApi.deletePolicy, '계산 규칙을 지웠어요.');
useDeletePayPolicy.permission = [
  'attendance.wage.write',
] as const satisfies PermissionRequirement;

export const useRemoveWageWorker = () =>
  useWageMutation(attendanceWageApi.removeWorker, '명단에서 뺐어요.');
useRemoveWageWorker.permission = [
  'attendance.wage.write',
] as const satisfies PermissionRequirement;

export const useUpdateWageRate = () =>
  useWageMutation(attendanceWageApi.updateRate, '시급을 고쳤어요.');
useUpdateWageRate.permission = [
  'attendance.wage.write',
] as const satisfies PermissionRequirement;

export const useDeleteWageRate = () =>
  useWageMutation(attendanceWageApi.deleteRate, '시급을 지웠어요.');
useDeleteWageRate.permission = [
  'attendance.wage.write',
] as const satisfies PermissionRequirement;

export const useUpdateWorkSchedule = () =>
  useWageMutation(attendanceWageApi.updateSchedule, '근무 시간표를 고쳤어요.');
useUpdateWorkSchedule.permission = [
  'attendance.wage.write',
] as const satisfies PermissionRequirement;

export const useDeleteWorkSchedule = () =>
  useWageMutation(attendanceWageApi.deleteSchedule, '근무 시간표를 지웠어요.');
useDeleteWorkSchedule.permission = [
  'attendance.wage.write',
] as const satisfies PermissionRequirement;

export const useUpdateMinimumWage = () =>
  useWageMutation(attendanceWageApi.updateMinimumWage, '최저임금을 고쳤어요.');
useUpdateMinimumWage.permission = [
  'attendance.wage.write',
] as const satisfies PermissionRequirement;

export const useDeleteMinimumWage = () =>
  useWageMutation(attendanceWageApi.deleteMinimumWage, '최저임금을 지웠어요.');
useDeleteMinimumWage.permission = [
  'attendance.wage.write',
] as const satisfies PermissionRequirement;

export const useClearWageDecision = () =>
  useWageMutation(attendanceWageApi.clearDecision, '판정을 취소했어요.');
useClearWageDecision.permission = [
  'attendance.request.review',
] as const satisfies PermissionRequirement;

/** 내려받기도 서버에 기록이 남는 동작이다 — 데이터를 받아 화면이 엑셀을 만든다. */
export const useExportSettlement = () =>
  useMutation({
    mutationFn: (
      target: { id: string } | { groupId: string; paydayMonth: string }
    ) =>
      'id' in target
        ? attendanceWageApi
            .exportSettlement(target.id)
            .then((record) => record.snapshot)
        : attendanceWageApi.exportPreview(target),
    onError: (error) => toast.error(attendanceError(error)),
  });
useExportSettlement.permission = [
  'attendance.wage.export',
] as const satisfies PermissionRequirement;
