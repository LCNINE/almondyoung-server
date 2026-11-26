import { useState } from 'react';
import { localStoragePrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import { useFeedback } from './FeedbackProvider';
import { readSoundPrefs, writeSoundPrefs, type SoundPrefs } from './soundPrefs';

/** 음량을 바꾸고 손을 떼면 그 음량으로 한 번 들려준다. */
export function SoundSettings({ prefs = localStoragePrefs }: { prefs?: DevicePrefs }) {
  const [sound, setSound] = useState<SoundPrefs>(() => readSoundPrefs(prefs));
  const { signal } = useFeedback();
  const update = (next: SoundPrefs) => {
    writeSoundPrefs(prefs, next);
    setSound(next);
  };
  return (
    <div className="flex flex-wrap items-center gap-[18px]">
      <span className="text-[13px] font-semibold text-[#27272a]">알림 음량</span>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        aria-label="음량"
        className="min-w-[60px] flex-1 accent-[#2563eb]"
        value={sound.volume}
        disabled={sound.muted}
        onChange={(e) => update({ ...sound, volume: Number(e.target.value) })}
        onPointerUp={() => signal('success')}
        onKeyUp={() => signal('success')}
      />
      <output className="w-[33px] text-xs tabular-nums text-[#27272a]">{sound.volume}%</output>
      <label className="flex items-center gap-[5px] text-xs whitespace-nowrap text-[#27272a]">
        <input
          type="checkbox"
          className="accent-[#2563eb]"
          checked={sound.muted}
          onChange={(e) => update({ ...sound, muted: e.target.checked })}
        />
        음소거
      </label>
    </div>
  );
}
