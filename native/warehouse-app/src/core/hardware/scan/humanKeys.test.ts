import { describe, expect, it } from 'vitest';
import { createHumanKeyDetector } from './humanKeys';

describe('createHumanKeyDetector', () => {
  it('혼자 들어온 글자는 다음 키가 늦게 오면 사람 것이다', () => {
    const d = createHumanKeyDetector();
    expect(d.feed('7', 0)).toEqual([]);
    expect(d.feed('3', 200)).toEqual(['7']);
    expect(d.flush(260)).toEqual(['3']);
  });

  it('미뤄 둔 글자는 묶음 간격이 지나야 낸다', () => {
    const d = createHumanKeyDetector();
    d.feed('5', 0);
    expect(d.flush(30)).toEqual([]);
    expect(d.flush(51)).toEqual(['5']);
    expect(d.flush(200)).toEqual([]);
  });

  it('스캐너 묶음과 그 끝의 Enter 는 사람 키가 아니다', () => {
    const d = createHumanKeyDetector();
    const out = [...'8801234'].flatMap((key, i) => d.feed(key, i * 5));
    expect([...out, ...d.feed('Enter', 40), ...d.flush(500)]).toEqual([]);
  });

  it('묶음 끝의 Enter 가 조금 늦어도(스캐너 끝 지연·긴 렌더) 스캔의 끝이다 — 사람 Enter 로 내지 않는다', () => {
    const d = createHumanKeyDetector();
    [...'8801'].forEach((key, i) => d.feed(key, i * 5));
    // 마지막 글자(15ms) 뒤 120ms
    expect(d.feed('Enter', 135)).toEqual([]);
    expect(d.flush(1000)).toEqual([]);
  });

  it('묶음이 끝나고 한참(300ms 넘게) 뒤에 온 Enter 는 사람 것이다', () => {
    const d = createHumanKeyDetector();
    [...'8801'].forEach((key, i) => d.feed(key, i * 5));
    // 마지막 글자(15ms) 뒤 400ms
    expect(d.feed('Enter', 415)).toEqual(['Enter']);
  });

  it('묶음 뒤 늦게 온 Enter 아닌 키는 전처럼 바로 내고 묶음 상태를 끊는다', () => {
    const d = createHumanKeyDetector();
    [...'8801'].forEach((key, i) => d.feed(key, i * 5));
    expect(d.feed('Backspace', 135)).toEqual(['Backspace']);
    // 끊겼으니 다음 Enter 는 사람 것이다
    expect(d.feed('Enter', 200)).toEqual(['Enter']);
  });

  it('제어 키는 바로 내고, 미뤄 둔 글자를 먼저 낸다', () => {
    const d = createHumanKeyDetector();
    d.feed('2', 0);
    expect(d.feed('Enter', 10)).toEqual(['2', 'Enter']);
    expect(d.feed('ArrowDown', 500)).toEqual(['ArrowDown']);
    expect(d.feed('Backspace', 900)).toEqual(['Backspace']);
    expect(d.feed('Escape', 1300)).toEqual(['Escape']);
  });

  it('모르는 제어 키는 내지 않되 미뤄 둔 글자는 낸다', () => {
    const d = createHumanKeyDetector();
    d.feed('4', 0);
    expect(d.feed('Tab', 100)).toEqual(['4']);
    expect(d.feed('Tab', 300)).toEqual([]);
  });

  it('수정 키는 통째로 무시한다 — 미뤄 둔 글자도 묶음 상태도 건드리지 않는다', () => {
    for (const mod of ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph']) {
      const x = createHumanKeyDetector();
      x.feed('4', 0);
      expect(x.feed(mod, 10)).toEqual([]);
      expect(x.flush(100)).toEqual(['4']);
    }
    // 스캐너가 대문자·기호에 Shift 를 끼워도 끝 Enter 는 새지 않는다
    const d = createHumanKeyDetector();
    const out = [
      ...d.feed('Shift', 0),
      ...d.feed('A', 2),
      ...d.feed('Shift', 5),
      ...d.feed('B', 10),
      ...d.feed('Shift', 15),
      ...d.feed('-', 20),
      ...d.feed('Enter', 25),
      ...d.flush(500),
    ];
    expect(out).toEqual([]);
  });

  it('reset 은 미뤄 둔 글자를 버린다', () => {
    const d = createHumanKeyDetector();
    d.feed('9', 0);
    d.reset();
    expect(d.flush(500)).toEqual([]);
  });
});
