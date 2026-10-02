import { Navigate } from '@tanstack/react-router';
import { isStationDevice } from '../station';
import { HandheldHome } from '../../profiles/handheld/HandheldHome';

/** 스테이션엔 홈이 없다 — 탭 바가 홈이고 첫 화면은 F1 출고 검수다. */
export function ProfileHome() {
  return isStationDevice() ? <Navigate to="/outbound" replace /> : <HandheldHome />;
}
