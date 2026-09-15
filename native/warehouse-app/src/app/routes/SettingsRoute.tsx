import { useDeveloperMode } from '../../core/diagnostics/DeveloperModeProvider';
import { Button } from '../../core/design/Button';
import { Link } from '@tanstack/react-router';
import { platform } from '@tauri-apps/plugin-os';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { WarehousePicker } from '../../domains/warehouse/WarehousePicker';
import { resolveProfile } from '../profile';

export function SettingsRoute() {
  const developer = useDeveloperMode();
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

      <section className="space-y-1">
        <h2 className="text-sm font-semibold text-gray-700">프로필</h2>
        <p className="text-sm text-gray-600">
          {resolveProfile(platform()) === 'station'
            ? '스테이션 (Windows)'
            : '핸드헬드'}
        </p>
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
