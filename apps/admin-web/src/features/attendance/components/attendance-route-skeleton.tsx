import { Skeleton } from '@/components/ui/skeleton';
import { AttendancePageLayout } from './attendance-page-layout';
import { AttendanceSettingsSkeleton } from './attendance-settings-skeleton';

export function AttendanceRouteSkeleton({
  title,
  calendar = false,
  settings = false,
}: {
  title: string;
  calendar?: boolean;
  settings?: boolean;
}) {
  return (
    <AttendancePageLayout title={title} wide={calendar} fillViewport={calendar}>
      {settings ? (
        <AttendanceSettingsSkeleton showHeading={false} />
      ) : (
        <section
          aria-busy="true"
          aria-label={`${title} 준비 중`}
          className="min-w-0 space-y-4 motion-reduce:[&_[data-slot=skeleton]]:animate-none"
        >
          <div aria-hidden className="flex items-center justify-between gap-4">
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-9 w-24" />
          </div>
          {calendar ? (
            <div
              aria-hidden
              className="grid grid-cols-7 gap-1 rounded-2xl border bg-white p-3"
            >
              {Array.from({ length: 35 }, (_, index) => (
                <div key={index} className="min-w-0 space-y-3 py-3">
                  <Skeleton className="mx-auto size-5 rounded-full" />
                  <Skeleton className="h-3 w-full" />
                </div>
              ))}
            </div>
          ) : (
            <div
              aria-hidden
              className="space-y-4 rounded-2xl border bg-white p-5"
            >
              {Array.from({ length: 5 }, (_, index) => (
                <div
                  key={index}
                  className="space-y-3 border-b border-slate-100 py-3 last:border-0"
                >
                  <Skeleton className="h-5 w-1/2" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </AttendancePageLayout>
  );
}
