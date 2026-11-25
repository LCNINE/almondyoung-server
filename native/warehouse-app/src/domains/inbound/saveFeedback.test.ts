import { describe, expect, it, vi } from 'vitest';

const play = vi.hoisted(() => vi.fn());
const prime = vi.hoisted(() => vi.fn());

vi.mock('../../station/feedback/soundPlayer', () => ({
  createSoundPlayer: vi.fn(() => ({ play })),
  defaultToneSink: vi.fn(() => ({ now: () => 0, beep: vi.fn(), prime })),
}));

import {
  createInboundSaveSound,
  playInboundSaveFailed,
  primeInboundSaveSound,
} from './saveFeedback';

function setup(
  prefs: { volume: number; muted: boolean },
  play: () => Promise<void> | void = () => undefined
) {
  const audio = { volume: 1, currentTime: 5, play: vi.fn(play) };
  const createAudio = vi.fn(() => audio);
  const errorPlayer = vi.fn();
  const sound = createInboundSaveSound({
    createAudio,
    readPrefs: () => prefs,
    errorPlayer,
  });

  return { audio, createAudio, errorPlayer, sound };
}

describe('createInboundSaveSound', () => {
  it('음량을 반영해 완료음을 재생한다', () => {
    const { audio, sound } = setup({ volume: 40, muted: false });
    sound.saved();
    expect(audio.volume).toBeCloseTo(0.4);
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it.each([
    { volume: 80, muted: true },
    { volume: 0, muted: false },
  ])('끄거나 음량 0 이면 재생하지 않는다 %o', (p) => {
    const { createAudio, sound } = setup(p);
    sound.saved();
    expect(createAudio).not.toHaveBeenCalled();
  });

  it('play 가 거절돼도 예외를 내지 않는다', async () => {
    const { sound } = setup({ volume: 80, muted: false }, () =>
      Promise.reject(new Error('NotAllowed'))
    );
    expect(() => sound.saved()).not.toThrow();
    await Promise.resolve();
  });

  it('오디오를 만들 수 없으면 조용히 넘어간다', () => {
    const sound = createInboundSaveSound({
      createAudio: () => null,
      readPrefs: () => ({ volume: 80, muted: false }),
      errorPlayer: vi.fn(),
    });
    expect(() => sound.saved()).not.toThrow();
  });

  it('준비해 둔 오디오 요소 하나를 저장마다 처음부터 다시 재생한다', () => {
    const { audio, createAudio, sound } = setup({ volume: 50, muted: false });
    sound.prime();
    audio.currentTime = 7;
    sound.saved();
    sound.saved();
    expect(createAudio).toHaveBeenCalledTimes(1);
    expect(audio.currentTime).toBe(0);
    expect(audio.play).toHaveBeenCalledTimes(2);
  });

  it('준비는 톤 싱크를 깨우고, 오디오나 컨텍스트가 없어도 예외를 내지 않는다', () => {
    const primeTones = vi.fn();
    const sound = createInboundSaveSound({
      createAudio: () => {
        throw new Error('no Audio');
      },
      readPrefs: () => ({ volume: 80, muted: false }),
      errorPlayer: vi.fn(),
      primeTones,
    });
    expect(() => sound.prime()).not.toThrow();
    expect(primeTones).toHaveBeenCalledTimes(1);
    expect(() => primeInboundSaveSound()).not.toThrow();
    expect(prime).toHaveBeenCalled();
  });

  it('실패하면 오류 톤을 낸다', () => {
    const { errorPlayer, sound } = setup({ volume: 80, muted: false });
    sound.failed();
    expect(errorPlayer).toHaveBeenCalledTimes(1);
  });

  it('playInboundSaveFailed 는 스테이션 error 톤을 낸다', () => {
    playInboundSaveFailed();
    expect(play).toHaveBeenCalledWith('error');
  });
});
