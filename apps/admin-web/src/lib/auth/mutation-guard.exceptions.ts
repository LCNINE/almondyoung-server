/**
 * master 만 쓰는 화면의 쓰기 동작(`<src 기준 파일>#<훅>`). admin 첫 부여로 만족하지 않는 게 의도다(관리자 계정·역할·역할 부여·외부 연동 키·급여).
 * 이 명단에 있는데 admin 이 실행할 수 있게 되면 게이트가 «명단에서 빼라»고 실패한다.
 */
export const MASTER_ONLY_MUTATIONS: readonly string[] = [
  'features/attendance/hooks/use-attendance-wage.ts#useDeletePayGroup',
  'features/attendance/hooks/use-attendance-wage.ts#useUpdatePayPolicy',
  'features/attendance/hooks/use-attendance-wage.ts#useDeletePayPolicy',
  'features/attendance/hooks/use-attendance-wage.ts#useRemoveWageWorker',
  'features/attendance/hooks/use-attendance-wage.ts#useUpdateWageRate',
  'features/attendance/hooks/use-attendance-wage.ts#useDeleteWageRate',
  'features/attendance/hooks/use-attendance-wage.ts#useUpdateWorkSchedule',
  'features/attendance/hooks/use-attendance-wage.ts#useDeleteWorkSchedule',
  'features/attendance/hooks/use-attendance-wage.ts#useUpdateMinimumWage',
  'features/attendance/hooks/use-attendance-wage.ts#useDeleteMinimumWage',
  'features/attendance/hooks/use-attendance-wage.ts#useClearWageDecision',
  'features/attendance/hooks/use-attendance-wage.ts#useAddMinimumWage',
  'features/attendance/hooks/use-attendance-wage.ts#useAddPayPolicy',
  'features/attendance/hooks/use-attendance-wage.ts#useAddWageRate',
  'features/attendance/hooks/use-attendance-wage.ts#useAddWorkSchedule',
  'features/attendance/hooks/use-attendance-wage.ts#useConfirmSettlement',
  'features/attendance/hooks/use-attendance-wage.ts#useCreatePayGroup',
  'features/attendance/hooks/use-attendance-wage.ts#useDecideAbsence',
  'features/attendance/hooks/use-attendance-wage.ts#useDecideOvertime',
  'features/attendance/hooks/use-attendance-wage.ts#useExportSettlement',
  'features/attendance/hooks/use-attendance-wage.ts#useReopenSettlement',
  'features/attendance/hooks/use-attendance-wage.ts#useSaveWageWorker',
  'features/attendance/hooks/use-attendance-wage.ts#useUpdatePayGroup',
  'lib/services/customers/mutations.ts#useSetUserRoles',
  'lib/services/iam/mutations.ts#useCreatePiiAccessReview',
  'lib/services/oauth-clients/mutations.ts#useClearOAuthClientPreviousSecret',
  'lib/services/oauth-clients/mutations.ts#useCreateOAuthClient',
  'lib/services/oauth-clients/mutations.ts#useDeactivateOAuthClient',
  'lib/services/oauth-clients/mutations.ts#useRotateOAuthClientSecret',
  'lib/services/oauth-clients/mutations.ts#useUpdateOAuthClient',
  'lib/services/roles/mutations.ts#useAddRoleMembers',
  'lib/services/roles/mutations.ts#useCreateRole',
  'lib/services/roles/mutations.ts#useDeleteRole',
  'lib/services/roles/mutations.ts#useRemoveRoleMember',
  'lib/services/roles/mutations.ts#useReplaceRolePermissions',
  'lib/services/roles/mutations.ts#useUpdateRole',
  'lib/services/users/mutations.ts#useCreateAdminAccount',
  'lib/services/users/mutations.ts#useReplaceStaffRoles',
];

/**
 * 화면 판정 누락 예외. 형식 `<src 기준 파일> :: <훅 이름>`, 사유 필수(«어떤 판정이 대신 막는가»).
 * 줄기만 해야 한다 — 고쳐진 예외는 지운다.
 */
export const UNGUARDED_MUTATIONS: readonly { readonly entry: string; readonly reason: string }[] = [];
