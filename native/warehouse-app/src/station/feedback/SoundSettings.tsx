import { useState } from 'react';
import { localStoragePrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import { useFeedback } from './FeedbackProvider';
import { readSoundPrefs, writeSoundPrefs, type SoundPrefs } from './soundPrefs';

/** 설정 화면의 「소리」 절(스테이션 전용). 음량을 바꾸고 손을 떼면 그 음량으로 한 번 들려준다. */
export function SoundSettings({ prefs = localStoragePrefs }: { prefs?: DevicePrefs }) {
  const [sound, setSound] = useState<SoundPrefs>(() => readSoundPrefs(prefs));
  const { signal } = useFeedback();
  const update = (next: SoundPrefs) => {
    writeSoundPrefs(prefs, next);
    setSound(next);
  };
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-gray-700">소리</h2>
      <div className="flex items-center gap-4">
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          aria-label="음량"
          value={sound.volume}
          disabled={sound.muted}
          onChange={(e) => update({ ...sound, volume: Number(e.target.value) })}
          onPointerUp={() => signal('success')}
          onKeyUp={() => signal('success')}
        />
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={sound.muted} onChange={(e) => update({ ...sound, muted: e.target.checked })} />
          끄기
        </label>
      </div>
    </section>
  );
}
