import { platform } from '@tauri-apps/plugin-os';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { WarehousePicker } from '../../domains/warehouse/WarehousePicker';
import { resolveProfile } from '../profile';

export function SettingsRoute() {
  return (
    <div className="space-y-5">
      <ScreenHeader title="설정" backTo="/" />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">이 기기의 창고</h2>
        <p className="text-xs text-gray-500">
          조정·실사는 여기서 고른 창고를 기준으로 기록돼요.
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
        <h2 className="text-sm font-semibold text-gray-700">그 외</h2>
        <p className="text-sm text-gray-500">
          백엔드 주소·프린터 IP·프로필 변경은 후속 Phase에서 열려요.
        </p>
      </section>
    </div>
  );
}
