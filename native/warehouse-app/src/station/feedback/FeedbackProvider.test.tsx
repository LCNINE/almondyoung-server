import { useCallback } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ScanProvider } from '../../core/hardware/scan/ScanProvider';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { scanHid } from '../../core/hardware/scan/__fixtures__/hid';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { FeedbackProvider, useFeedback, useFlash } from './FeedbackProvider';
import type { Beep, ToneSink } from './soundPlayer';
import { SOUND_MUTED_KEY } from './soundPrefs';
import type { FeedbackKind } from './tones';

function Probe({ onScanSignal }: { onScanSignal?: FeedbackKind }) {
  const { signal } = useFeedback();
  const flash = useFlash();
  useScanner(
    useCallback(() => {
      if (onScanSignal) signal(onScanSignal);
    }, [signal, onScanSignal])
  );
  return (
    <>
      <p data-testid="flash">{flash ?? 'none'}</p>
      <button onClick={() => signal('error')}>오류</button>
      <button onClick={() => signal('complete')}>완료</button>
    </>
  );
}

function setup(opts: { onScanSignal?: FeedbackKind; muted?: boolean } = {}) {
  const beeps: Beep[] = [];
  const sink: ToneSink = { now: () => 0, beep: (b) => void beeps.push(b) };
  const prefs = createMemoryPrefs(opts.muted ? { [SOUND_MUTED_KEY]: '1' } : {});
  render(
    <ScanProvider>
      <FeedbackProvider prefs={prefs} sink={sink}>
        <Probe onScanSignal={opts.onScanSignal} />
      </FeedbackProvider>
    </ScanProvider>
  );
  return { beeps };
}

describe('FeedbackProvider', () => {
  it('오류는 소리와 빨간 테두리, 다음 스캔에서 테두리가 사라진다', () => {
    const { beeps } = setup();
    fireEvent.click(screen.getByRole('button', { name: '오류' }));
    expect(screen.getByTestId('flash')).toHaveTextContent('error');
    expect(beeps.length).toBeGreaterThan(0);
    scanHid(document.body, '8801234');
    expect(screen.getByTestId('flash')).toHaveTextContent('none');
  });

  it('완료는 초록', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: '완료' }));
    expect(screen.getByTestId('flash')).toHaveTextContent('complete');
  });

  it('화면이 «그 스캔» 의 처리에서 낸 오류는 같은 스캔이 지우지 않는다', () => {
    setup({ onScanSignal: 'error' });
    scanHid(document.body, '8801234');
    expect(screen.getByTestId('flash')).toHaveTextContent('error');
  });

  it('소리를 꺼도 테두리는 남는다', () => {
    const { beeps } = setup({ muted: true });
    fireEvent.click(screen.getByRole('button', { name: '오류' }));
    expect(beeps).toHaveLength(0);
    expect(screen.getByTestId('flash')).toHaveTextContent('error');
  });

  it('셸 밖(핸드헬드)에서 useFeedback 은 아무 일도 하지 않는다', () => {
    function Bare() {
      const { signal } = useFeedback();
      return <button onClick={() => signal('error')}>신호</button>;
    }
    render(<Bare />);
    expect(() => fireEvent.click(screen.getByRole('button', { name: '신호' }))).not.toThrow();
  });
});
