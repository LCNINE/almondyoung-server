import { describe, expect, it } from 'vitest';
import { createSoundPlayer, type Beep, type ToneSink } from './soundPlayer';
import type { SoundPrefs } from './soundPrefs';
import { TONES, type FeedbackKind } from './tones';

function recorder(now = 10) {
  const beeps: Beep[] = [];
  const sink: ToneSink = {
    now: () => now,
    beep: (b) => {
      beeps.push(b);
    },
  };
  return { beeps, sink };
}

const prefs = (p: SoundPrefs) => () => p;

describe('createSoundPlayer', () => {
  it('완료음은 두 음을 시작 시각에서 어긋나게, 음량 비례 이득으로 낸다', () => {
    const { beeps, sink } = recorder(10);
    createSoundPlayer({ sink, readPrefs: prefs({ volume: 50, muted: false }) }).play('complete');
    expect(beeps).toHaveLength(2);
    expect(beeps[0]).toMatchObject({ frequency: 1047, wave: 'sine', at: 10 });
    expect(beeps[0].gain).toBeCloseTo(0.15);
    expect(beeps[1].frequency).toBe(1568);
    expect(beeps[1].at).toBeCloseTo(10.12);
    expect(beeps[1].duration).toBeCloseTo(0.22);
  });

  it.each([
    { volume: 80, muted: true },
    { volume: 0, muted: false },
  ])('끄거나 음량 0 이면 소리를 내지 않는다 %o', (p) => {
    const { beeps, sink } = recorder();
    createSoundPlayer({ sink, readPrefs: prefs(p) }).play('error');
    expect(beeps).toHaveLength(0);
  });

  it('소리 장치가 없으면(jsdom·구형 웹뷰) 조용히 넘어간다', () => {
    expect(() => createSoundPlayer({ sink: null, readPrefs: prefs({ volume: 80, muted: false }) }).play('success')).not.toThrow();
  });

  it('네 소리는 서로 다르다 — 화면을 안 보고 구별해야 한다', () => {
    const kinds: FeedbackKind[] = ['success', 'error', 'complete', 'command'];
    const signatures = kinds.map((k) => JSON.stringify(TONES[k]));
    expect(new Set(signatures).size).toBe(4);
  });
});
