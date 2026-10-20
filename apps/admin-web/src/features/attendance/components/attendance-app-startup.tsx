'use client';

import { useEffect, useState } from 'react';
import { useAttendance } from '../hooks/use-attendance';
import { AttendanceClockScene } from './attendance-clock-scene';

type StartupMode = 'initial' | 'starting' | 'done' | 'preview';

export function scheduleSplashMinimum(onElapsed: () => void) {
  const timer = setTimeout(onElapsed, 1500);

  return () => clearTimeout(timer);
}

export function AttendanceBrandSplash({
  className = '',
  hiddenFromReader = false,
  preview = false,
}: {
  className?: string;
  hiddenFromReader?: boolean;
  preview?: boolean;
}) {
  return (
    <div
      role="img"
      data-splash-preview={preview || undefined}
      aria-label="아몬드영 워크 시작 화면"
      aria-hidden={hiddenFromReader || undefined}
      className={`fixed inset-0 z-[100] overflow-hidden ${className}`}
      style={{ backgroundColor: '#FFFBF5' }}
    >
      <style>{`
        .tsqd-parent-container {
          display: none !important;
        }

        .attendance-clock-hand {
          transform-origin: 280px 89px;
          animation: attendance-hand-sway 4800ms ease-in-out infinite;
        }

        .attendance-clock-mascot {
          transform-origin: 184px 141px;
          animation: attendance-mascot-sway 2400ms ease-in-out infinite;
        }

        .attendance-clock-leg-left {
          transform-origin: 186px 245px;
          animation: attendance-left-kick 2400ms ease-in-out infinite;
        }

        .attendance-clock-leg-right {
          transform-origin: 207px 245px;
          animation: attendance-right-kick 2400ms ease-in-out infinite;
        }

        .attendance-clock-second {
          transform-origin: 280px 89px;
          animation: attendance-clock-tick 8s steps(4, end) infinite alternate;
        }

        .attendance-clock-eyes {
          transform-box: fill-box;
          transform-origin: center;
          animation: attendance-clock-blink 5200ms ease-in-out infinite;
        }

        @keyframes attendance-hand-sway {
          0%, 100% { transform: rotate(-1.5deg); }
          50% { transform: rotate(1.5deg); }
        }

        @keyframes attendance-mascot-sway {
          0%, 100% { transform: rotate(-4deg); }
          50% { transform: rotate(4deg); }
        }

        @keyframes attendance-left-kick {
          0%, 100% { transform: rotate(3deg); }
          50% { transform: rotate(-7deg); }
        }

        @keyframes attendance-right-kick {
          0%, 100% { transform: rotate(-5deg); }
          50% { transform: rotate(6deg); }
        }

        @keyframes attendance-clock-tick {
          from { transform: rotate(-5deg); }
          to { transform: rotate(7deg); }
        }

        @keyframes attendance-clock-blink {
          0%, 43%, 47%, 100% { transform: scaleY(1); }
          45% { transform: scaleY(.1); }
        }

        @media (prefers-reduced-motion: reduce) {
          .attendance-clock-hand,
          .attendance-clock-mascot,
          .attendance-clock-leg-left,
          .attendance-clock-leg-right,
          .attendance-clock-second,
          .attendance-clock-eyes {
            animation: none;
          }
        }
      `}</style>
      <div className="absolute top-[45%] left-0 flex w-full -translate-y-1/2 flex-col items-center gap-6 px-6">
        <div className="w-[min(74vw,30svh,280px)]">
          <AttendanceClockScene />
        </div>
        <p className="text-center text-[20px] leading-[26px] font-semibold tracking-[-0.03em] text-[#443D37]">
          아몬드영 워크
        </p>
      </div>
    </div>
  );
}

export function AttendanceAppStartup({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isPending } = useAttendance();
  const [mode, setMode] = useState<StartupMode>('initial');
  const [minimumElapsed, setMinimumElapsed] = useState(false);

  useEffect(() => {
    const preview =
      new URLSearchParams(window.location.search).get('splash') === 'preview';
    const installed =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;

    if (preview) {
      setMode('preview');

      return;
    }

    if (!installed) {
      setMode('done');

      return;
    }

    setMode('starting');

    if (process.env.NODE_ENV === 'development') {
      void import('../lib/attendance-startup-diagnostic')
        .then(({ reportInstalledStartup }) => reportInstalledStartup())
        .catch(() => undefined);
    }

    const cancelMinimum = scheduleSplashMinimum(() => setMinimumElapsed(true));

    // Fail open to the page's own skeleton/error UI when the network is slow.
    const timeout = window.setTimeout(() => setMode('done'), 4000);

    return () => {
      cancelMinimum();
      window.clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    if (mode === 'starting' && minimumElapsed && !isPending) {
      setMode('done');
    }
  }, [isPending, minimumElapsed, mode]);

  const active = mode === 'starting' || mode === 'preview';

  return (
    <>
      {mode !== 'done' && (
        <AttendanceBrandSplash
          className={
            mode === 'initial'
              ? 'hidden [@media(display-mode:standalone)]:block'
              : ''
          }
          hiddenFromReader={!active}
          preview={mode === 'preview'}
        />
      )}
      <div aria-hidden={active || undefined} inert={active || undefined}>
        {children}
      </div>
    </>
  );
}
