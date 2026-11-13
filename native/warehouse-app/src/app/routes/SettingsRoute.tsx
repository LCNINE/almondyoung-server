import { useState } from 'react';
import { useDeveloperMode } from '../../core/diagnostics/DeveloperModeProvider';
import { Button } from '../../core/design/Button';
import { Link } from '@tanstack/react-router';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { WarehousePicker } from '../../domains/warehouse/WarehousePicker';
import { LabelPrinterSettings } from '../../core/hardware/print/LabelPrinterSettings';
import { isStationDevice } from '../station';
import { useSession } from '../session-context';
import { SoundSettings } from '../../station/feedback/SoundSettings';
import { useUnresolvedWork } from '../../core/operations/workArea';
import { useWorkerIdentity } from '../useWorkerIdentity';

export function SettingsRoute() {
  const developer = useDeveloperMode();
  const session = useSession();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [checking, setChecking] = useState(false);
  const worker = useWorkerIdentity();
  const unresolved = useUnresolvedWork();
  const needsWarning = unresolved.count > 0 || unresolved.unknown;

  const recheck = async () => {
    setChecking(true);
    try {
      await unresolved.recheck();
    } finally {
      setChecking(false);
    }
  };

  const signOut = async () => {
    setConfirming(false);
    setSigningOut(true);
    setSignOutFailed(false);

    try {
      await (session.signOut ?? session.logout)();
    } catch {
      setSignOutFailed(true);
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="space-y-5">
      <ScreenHeader title="설정" backTo="/" />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">이 기기의 창고</h2>
        <p className="text-xs text-gray-500">
          입고·적치·이동·조정·실사는 여기서 고른 창고를 기준으로 기록돼요.
        </p>
        <WarehousePicker />
      </section>

      {isStationDevice() && (
        <>
          <LabelPrinterSettings />
          <SoundSettings />
          <Link to="/station/command-sheet" className="text-sm font-medium text-blue-700 underline">
            명령 바코드 시트
          </Link>
        </>
      )}

      <section className="space-y-1">
        <h2 className="text-sm font-semibold text-gray-700">프로필</h2>
        <p className="text-sm text-gray-600">
          {isStationDevice() ? '스테이션' : '핸드헬드'}
        </p>
      </section>

      <section className="space-y-1">
        <h2 className="text-sm font-semibold text-gray-700">계정</h2>
        {worker.status === 'ready' && (
          <p className="text-sm text-gray-800">
            로그인한 작업자{' '}
            <strong className="font-semibold">{worker.identity.name}</strong>
            {worker.identity.loginId && (
              <span className="text-gray-500"> ({worker.identity.loginId})</span>
            )}
          </p>
        )}
        {worker.status === 'loading' && (
          <p className="text-sm text-gray-500">작업자를 확인하고 있어요.</p>
        )}
        {worker.status === 'failed' && (
          <p className="text-sm text-gray-600">
            작업자를 확인하지 못했어요.{' '}
            <button
              type="button"
              className="font-medium text-blue-700 underline"
              onClick={worker.retry}
            >
              다시 확인
            </button>
          </p>
        )}
        <p className="text-xs text-gray-500">
          다른 계정으로 바꾸려면 로그아웃한 뒤 다시 로그인해 주세요.
        </p>
        <Button
          disabled={signingOut || (confirming && needsWarning)}
          onClick={() => (needsWarning ? setConfirming(true) : void signOut())}
        >
          로그아웃
        </Button>
        {confirming && needsWarning && (
          <div
            role="alert"
            className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          >
            <p>
              {unresolved.count > 0
                ? `처리 결과를 확인하지 못한 작업이 ${unresolved.count}건 있어요.`
                : '이 기기에 남은 작업을 아직 확인하지 못했어요.'}{' '}
              로그아웃하면 이 계정으로 다시 로그인할 때까지 확인할 수 없어요.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={checking} onClick={() => void recheck()}>
                처리 내역 확인
              </Button>
              <Button disabled={signingOut} onClick={() => void signOut()}>
                그래도 로그아웃
              </Button>
              <Button onClick={() => setConfirming(false)}>취소</Button>
            </div>
          </div>
        )}
        {confirming && !needsWarning && (
          <p role="status" className="text-xs text-gray-600">
            남은 작업을 모두 확인했어요. 이제 로그아웃할 수 있어요.
          </p>
        )}
        {signOutFailed && (
          <p role="alert" className="text-xs text-red-600">
            로그아웃하지 못했어요. 다시 눌러 주세요.
          </p>
        )}
      </section>

      <section className="space-y-1">
        <Button onClick={() => void developer.toggle()}>
          {developer.enabled ? '개발자 모드 끄기' : '개발자 모드 켜기'}
        </Button>
        {developer.enabled && <Link to="/diagnostics">개발자 진단 열기</Link>}
      </section>
    </div>
  );
}
