import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import { IamTabs } from '@/features/iam/components/iam-tabs';
import { PiiAccessLog } from '@/features/iam/pii-access/pii-access-log';

export default function PiiAccessLogPage() {
  return (
    <RouteGuard screen="/users/pii-access-log">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <IamTabs current="pii" />
        <Suspense>
          <PiiAccessLog />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
