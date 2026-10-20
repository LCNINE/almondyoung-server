import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import { IamTabs } from '@/features/iam/components/iam-tabs';
import { AuditLog } from '@/features/iam/audit/audit-log';

export default function AuditLogPage() {
  return (
    <RouteGuard screen="/users/audit-log">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <IamTabs current="audit" />
        <Suspense>
          <AuditLog />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
