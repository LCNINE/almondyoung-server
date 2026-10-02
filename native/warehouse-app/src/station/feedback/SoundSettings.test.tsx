import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ScanProvider } from '../../core/hardware/scan/ScanProvider';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { FeedbackProvider } from './FeedbackProvider';
import { SoundSettings } from './SoundSettings';
import type { Beep, ToneSink } from './soundPlayer';
import { SOUND_MUTED_KEY, SOUND_VOLUME_KEY } from './soundPrefs';

describe('SoundSettings', () => {
  it('음량을 저장하고, 손을 떼면 그 음량으로 한 번 들려준다', () => {
    const beeps: Beep[] = [];
    const sink: ToneSink = { now: () => 0, beep: (b) => void beeps.push(b) };
    const prefs = createMemoryPrefs();
    render(
      <ScanProvider>
        <FeedbackProvider prefs={prefs} sink={sink}>
          <SoundSettings prefs={prefs} />
        </FeedbackProvider>
      </ScanProvider>
    );
    const slider = screen.getByRole('slider', { name: '음량' });
    fireEvent.change(slider, { target: { value: '40' } });
    expect(prefs.get(SOUND_VOLUME_KEY)).toBe('40');
    fireEvent.pointerUp(slider);
    expect(beeps).toHaveLength(1);
    expect(beeps[0].gain).toBeCloseTo(0.4 * 0.3);

    fireEvent.click(screen.getByRole('checkbox', { name: '끄기' }));
    expect(prefs.get(SOUND_MUTED_KEY)).toBe('1');
    expect(slider).toBeDisabled();
  });
});
