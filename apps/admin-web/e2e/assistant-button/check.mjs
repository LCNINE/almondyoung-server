import assert from 'node:assert/strict';

// Run with an ego-browser Page showing the admin header or isolated AssistantButton preview.
export async function checkAssistantButton(page) {
  const selector = 'button[aria-label="아몬드영 AI 챗봇 열기"]';
  const ringState = () => {
    const button = document.querySelector('button[aria-label="아몬드영 AI 챗봇 열기"]');
    const ring = button.querySelector('span > span[aria-hidden]');
    const style = getComputedStyle(ring, '::before');
    return {
      video: !!button.querySelector('video'),
      gradient: style.backgroundImage.includes('conic-gradient'),
      fixedCircle: getComputedStyle(ring).transform === 'none' && getComputedStyle(ring).clipPath.startsWith('circle('),
      rotating: ring.getAnimations({ subtree: true }).some((animation) => animation.playState === 'running'),
      logo: !!button.querySelector('svg'),
    };
  };

  try {
    await page.cdp('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    });
    assert.deepEqual(await page.evaluate(ringState), {
      video: false,
      gradient: true,
      fixedCircle: true,
      rotating: true,
      logo: true,
    });

    const dimensions = () => {
      const button = document.querySelector(
        'button[aria-label="아몬드영 AI 챗봇 열기"]'
      );
      return { width: button.offsetWidth, height: button.offsetHeight };
    };
    await page.mouse.move(0, 0);
    assert.deepEqual(await page.evaluate(dimensions), {
      width: 32,
      height: 32,
    });
    await page.hover(`${selector} >> nth=0`);
    await page.waitForFunction(() => {
      const button = document.querySelector(
        'button[aria-label="아몬드영 AI 챗봇 열기"]'
      );
      return button.offsetWidth > 32 && button.getAnimations().length === 0;
    });
    assert.ok((await page.evaluate(dimensions)).width > 100);
    await page.mouse.move(0, 0);
    await page.waitForFunction(
      () =>
        document.querySelector('button[aria-label="아몬드영 AI 챗봇 열기"]')
          .offsetWidth === 32
    );

    await page.cdp('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    assert.equal((await page.evaluate(ringState)).rotating, false);

    await page.click(`${selector} >> nth=0`);
    await page.waitForSelector('[role=dialog]', { state: 'visible' });
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role=dialog]', { state: 'hidden' });
  } finally {
    await page.cdp('Emulation.setEmulatedMedia', { features: [] });
  }
  console.log(
    'PASS: CSS ring without video, circular default, hover expansion/collapse, reduced motion, and chat open/close'
  );
}
