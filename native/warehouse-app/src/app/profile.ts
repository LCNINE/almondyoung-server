export type Profile = 'station' | 'handheld';

/**
 * Default entry profile per platform (spec §3). Windows packing stations get
 * the station UI; everything else (Android handhelds, dev on linux) defaults
 * to handheld. `override` (from the settings screen) always wins.
 */
export function resolveProfile(platform: string, override?: Profile): Profile {
  if (override) return override;
  return platform === 'windows' ? 'station' : 'handheld';
}
