'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';

export function AttendanceRefreshButton() {
  const [refreshing, setRefreshing] = useState(false);

  function refresh() {
    setRefreshing(true);

    window.location.reload();
  }

  return (
    <button
      type="button"
      aria-label="화면 새로고침"
      title="화면 새로고침"
      disabled={refreshing}
      onClick={refresh}
      className="flex size-11 shrink-0 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 active:bg-slate-200 disabled:opacity-50"
    >
      <RefreshCw
        className={`size-5 ${refreshing ? 'animate-spin motion-reduce:animate-none' : ''}`}
        aria-hidden
      />
    </button>
  );
}
