import { platform } from '@tauri-apps/plugin-os';
import { resolveProfile } from '../profile';
import { StationHome } from '../../profiles/station/StationHome';
import { HandheldHome } from '../../profiles/handheld/HandheldHome';

export function ProfileHome() {
  return resolveProfile(platform()) === 'station' ? (
    <StationHome />
  ) : (
    <HandheldHome />
  );
}
