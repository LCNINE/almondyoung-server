import { useDeveloperMode } from '../../core/diagnostics/DeveloperModeProvider';
import { Button } from '../../core/design/Button';
import { Link } from '@tanstack/react-router';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { WarehousePicker } from '../../domains/warehouse/WarehousePicker';
import { LabelPrinterSettings } from '../../core/hardware/print/LabelPrinterSettings';
import { isStationDevice } from '../station';
import { ReturnBinSettings } from '../../domains/returns/ReturnBinSettings';
import { SoundSettings } from '../../station/feedback/SoundSettings';

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

      {isStationDevice() && (
        <>
          <LabelPrinterSettings />
          <SoundSettings />
          <Link to="/station/command-sheet" className="text-sm font-medium text-blue-700 underline">
            명령 바코드 시트
          </Link>
        </>
      )}

      <ReturnBinSettings />

      <section className="space-y-1">
        <h2 className="text-sm font-semibold text-gray-700">프로필</h2>
        <p className="text-sm text-gray-600">
          {isStationDevice() ? '스테이션' : '핸드헬드'}
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
