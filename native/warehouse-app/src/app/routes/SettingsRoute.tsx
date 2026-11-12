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

export function SettingsRoute() {
  const developer = useDeveloperMode();
  const session = useSession();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);

  const signOut = async () => {
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
        <p className="text-xs text-gray-500">
          다른 계정으로 바꾸려면 로그아웃한 뒤 다시 로그인해 주세요.
        </p>
        <Button disabled={signingOut} onClick={() => void signOut()}>
          로그아웃
        </Button>
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
