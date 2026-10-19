'use client';

import { useId } from 'react';
import { ATTENDANCE_CLOCK_ART } from '../lib/attendance-clock-art';

export function AttendanceClockScene() {
  const id = useId();

  return (
    <svg
      viewBox="0 0 360 380"
      aria-hidden="true"
      className="block h-auto w-full overflow-hidden"
      dangerouslySetInnerHTML={{
        __html: ATTENDANCE_CLOCK_ART.replaceAll('__CLOCK_ID__', id),
      }}
    />
  );
}
