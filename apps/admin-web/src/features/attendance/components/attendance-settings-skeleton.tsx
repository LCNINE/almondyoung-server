import { Skeleton } from '@/components/ui/skeleton';

function HeadingSkeleton({ showHeading }: { showHeading: boolean }) {
  return (
    <div>
      {showHeading && <Skeleton className="h-8 w-48 max-w-full" />}
      <Skeleton className="mt-2 h-5 w-72 max-w-full" />
    </div>
  );
}

export function AttendanceSettingsSkeleton({
  showHeading,
}: {
  showHeading: boolean;
}) {
  return (
    <section
      aria-busy="true"
      className="max-w-xl space-y-6 motion-reduce:[&_[data-slot=skeleton]]:animate-none"
    >
      <span role="status" className="sr-only">
        근무 설정을 불러오는 중이에요.
      </span>
      <div aria-hidden className="space-y-6">
        <HeadingSkeleton showHeading={showHeading} />
        <div className="space-y-5 rounded-2xl border bg-white p-6">
          <Skeleton className="h-5 w-28" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[0, 1].map((field) => (
              <div key={field} className="space-y-2">
                <Skeleton className="h-4 w-8" />
                <Skeleton className="h-11 w-full" />
              </div>
            ))}
          </div>
          <Skeleton className="h-6 w-64 max-w-full" />
        </div>
        <div className="space-y-6 rounded-2xl border bg-white p-6">
          <Skeleton className="h-5 w-28" />
          {[0, 1].map((field) => (
            <div key={field} className="space-y-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-5 w-9 rounded-full" />
              </div>
              <Skeleton className="h-11 w-full" />
            </div>
          ))}
          <div className="space-y-3">
            <Skeleton className="h-4 w-24" />
            <div className="flex flex-wrap gap-3">
              {Array.from({ length: 7 }, (_, day) => (
                <Skeleton key={day} className="h-5 w-9" />
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-5 w-9 rounded-full" />
          </div>
          <Skeleton className="h-12 w-full" />
        </div>
        <div className="flex items-center justify-between rounded-2xl border bg-white p-6">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-9 rounded-full" />
        </div>
        <Skeleton className="h-9 w-24" />
      </div>
    </section>
  );
}

export function WorksiteSettingsSkeleton({
  showHeading,
}: {
  showHeading: boolean;
}) {
  return (
    <section
      aria-busy="true"
      className="max-w-xl space-y-6 motion-reduce:[&_[data-slot=skeleton]]:animate-none"
    >
      <span role="status" className="sr-only">
        근무지를 불러오는 중이에요.
      </span>
      <div aria-hidden className="space-y-6">
        <HeadingSkeleton showHeading={showHeading} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-11 w-28" />
        </div>
        <div className="space-y-3">
          {[0, 1].map((site) => (
            <div
              key={site}
              className="flex items-start justify-between gap-3 rounded-2xl border bg-white p-4 sm:p-5"
            >
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-6 w-20" />
                  <Skeleton className="h-6 w-14" />
                </div>
                <Skeleton className="h-6 w-full max-w-64" />
              </div>
              <Skeleton className="h-11 w-14 shrink-0" />
            </div>
          ))}
        </div>
        <Skeleton className="h-11 w-full" />
      </div>
    </section>
  );
}
