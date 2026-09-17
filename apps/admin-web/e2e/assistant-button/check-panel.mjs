import assert from 'node:assert/strict';

// Real browser file drag/drop (isTrusted), including while an answer is pending.
// Use a fresh local preview and pass an absolute path to an existing image file.
export async function checkNativeFileDrop(page, imagePath) {
  await page.evaluate(() => {
    window.__nativeOriginalFetch = window.fetch;
    window.fetch = () => new Promise((resolve) => { window.__nativeResolve = resolve; });
  });
  async function dropOnInput() {
    const point = await page.evaluate(() => {
      const rect = document.querySelector('textarea').getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await page.cdp('Input.dispatchDragEvent', {
        type, ...point, data: { items: [], files: [imagePath], dragOperationsMask: 1 },
      });
    }
  }
  try {
    await dropOnInput();
    await page.waitForFunction(() => document.querySelector('form img')?.naturalWidth > 0);
    await page.evaluate(() => document.querySelector('button[aria-label="보내기"]').click());
    await page.waitForFunction(() => !!window.__nativeResolve);
    await dropOnInput();
    await page.waitForFunction(() => document.querySelectorAll('form img').length === 2);
    assert.equal(await page.evaluate(() => document.querySelector('button[aria-label="보내기"]').disabled), true);
    await page.evaluate(() => window.__nativeResolve(new Response(JSON.stringify({
      message: '첨부 확인', consumedIds: [],
    }), { status: 200 })));
    await page.waitForFunction(() => !document.querySelector('textarea').readOnly);
    assert.equal(await page.evaluate(() => document.querySelectorAll('form img').length), 2);
    console.log('PASS: native file drop into textarea, drop while response pending, attachments retained');
  } finally {
    await page.evaluate(() => {
      window.fetch = window.__nativeOriginalFetch;
      delete window.__nativeOriginalFetch;
      delete window.__nativeResolve;
    });
  }
}

// Run with an ego-browser Page showing a freshly opened AssistantPanel.
// All requests are intercepted; this check never executes real product operations.
export async function checkAssistantPanel(page) {
  await page.evaluate(() => {
    window.__panelFetch = window.fetch;
    window.__panelRequests = [];
    window.fetch = (url, options) => {
      window.__panelRequests.push({
        url: String(url),
        messages: JSON.parse(options.body.get('messages')),
        files: options.body.getAll('files').map((file) => file.name),
      });
      return new Promise((resolve) => { window.__panelResolve = resolve; });
    };
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent.includes('상품 찾아보기')).click();
  });
  try {
    await page.waitForFunction(() => document.querySelector('textarea').value === '상품 목록을 5개 보여줘.');
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['outside'], 'outside.xlsx'));
      for (const selector of ['[data-slot=sheet-header]', '[role=log]', '[data-slot=sheet-overlay]']) {
        const target = document.querySelector(selector);
        for (const type of ['dragenter', 'drop']) {
          target.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
        }
      }
    });
    assert.equal(await page.evaluate(() => !!document.querySelector('[role=status], button[aria-label="outside.xlsx 첨부 취소"]')), false);
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 16;
      canvas.getContext('2d').fillRect(0, 0, 16, 16);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve));
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], '미리보기.png', { type: 'image/png' }));
      window.__panelDrop = transfer;
      document.querySelector('textarea').dispatchEvent(new DragEvent('dragenter', {
        dataTransfer: transfer, bubbles: true, cancelable: true,
      }));
    });
    await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent.includes('여기에 놓으세요'));
    assert.ok(await page.evaluate(() => {
      const form = document.querySelector('form').getBoundingClientRect();
      const hint = document.querySelector('form [role=status]').getBoundingClientRect();
      return hint.top >= form.top && hint.bottom <= form.bottom && hint.left >= form.left && hint.right <= form.right;
    }));
    await page.evaluate(() => {
      document.querySelector('textarea').dispatchEvent(new DragEvent('drop', {
        dataTransfer: window.__panelDrop, bubbles: true, cancelable: true,
      }));
      delete window.__panelDrop;
    });
    await page.waitForFunction(() => document.querySelector('img[alt="미리보기.png"]')?.naturalWidth === 16);
    assert.equal(await page.evaluate(() => !!document.querySelector('[role=status]')), false);
    assert.deepEqual(await page.evaluate(() => {
      const tile = document.querySelector('img[alt="미리보기.png"]').parentElement;
      return [tile.offsetWidth, tile.offsetHeight];
    }), [72, 72]);
    await page.evaluate(() => document.querySelector('button[aria-label="미리보기.png 첨부 취소"]').click());
    await page.waitForFunction(() => !document.querySelector('img[alt="미리보기.png"]'));
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['unsupported'], 'test.txt', { type: 'text/plain' }));
      document.querySelector('textarea').dispatchEvent(new DragEvent('drop', {
        dataTransfer: transfer, bubbles: true, cancelable: true,
      }));
    });
    await page.waitForFunction(() => document.querySelector('[role=alert]')?.textContent.includes('.xlsx'));
    assert.equal(await page.evaluate(() => !!document.querySelector('button[aria-label="test.txt 첨부 취소"]')), false);
    await page.evaluate(() => {
      document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', isComposing: true, bubbles: true,
      }));
      const transfer = new DataTransfer();
      transfer.items.add(new File(['demo'], '상품.xlsx'));
      const input = document.querySelector('input[type=file]');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    assert.equal(await page.evaluate(() => window.__panelRequests.length), 0);
    await page.waitForSelector('button[aria-label="상품.xlsx 첨부 취소"]', { state: 'attached' });
    await page.evaluate(() => document.querySelector('button[aria-label="보내기"]').click());
    await page.waitForFunction(() => document.querySelector('textarea').readOnly);
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['pending'], 'pending.xlsx'));
      document.querySelector('textarea').dispatchEvent(new DragEvent('drop', {
        dataTransfer: transfer, bubbles: true, cancelable: true,
      }));
    });
    assert.equal(await page.evaluate(() => !!document.querySelector('button[aria-label="pending.xlsx 첨부 취소"]')), true);
    assert.deepEqual(await page.evaluate(() => window.__panelRequests[0].files), ['상품.xlsx']);
    await page.evaluate(() => window.__panelResolve(new Response(JSON.stringify({ message: '확인용 오류' }), { status: 500 })));
    await page.waitForFunction(() => !document.querySelector('textarea').readOnly);
    assert.equal(await page.evaluate(() => document.querySelector('textarea').value), '상품 목록을 5개 보여줘.');
    await page.waitForSelector('button[aria-label="상품.xlsx 첨부 취소"]', { state: 'attached' });
    assert.equal(await page.evaluate(() => document.querySelector('[role=log]').textContent), '');
    await page.evaluate(() => document.querySelector('button[aria-label="보내기"]').click());
    await page.waitForFunction(() => window.__panelRequests.length === 2);
    assert.equal(await page.evaluate(() => window.__panelRequests[1].messages.length), 1);
    await page.evaluate(() => window.__panelResolve(new Response(JSON.stringify({ message: '**처리 완료**', toolCalls: [] }), { status: 200 })));
    await page.waitForFunction(() => document.querySelector('[role=log] strong')?.textContent === '처리 완료');
    assert.deepEqual(await page.evaluate(() => {
      const overlay = getComputedStyle(document.querySelector('[data-slot=sheet-overlay]'));
      return [overlay.backgroundColor, overlay.backdropFilter,
        getComputedStyle(document.querySelector('[role=dialog] > button:last-child')).cursor];
    }), ['rgba(0, 0, 0, 0)', 'none', 'pointer']);
    await page.cdp('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
    assert.ok(await page.evaluate(() => {
      const panel = document.querySelector('[role=dialog]');
      return panel.offsetWidth <= innerWidth && panel.scrollWidth <= panel.clientWidth;
    }));
    await page.evaluate(() => document.querySelector('[role=dialog] > button:last-child').click());
    await page.waitForSelector('[role=dialog]', { state: 'hidden' });
    console.log('PASS: draft suggestion, Korean IME, attachments, pending state, failure recovery, retry history, response, transparent overlay, close cursor, mobile width, close');
  } finally {
    await page.evaluate(() => {
      window.fetch = window.__panelFetch;
      delete window.__panelFetch;
      delete window.__panelRequests;
      delete window.__panelResolve;
    });
    await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  }
}
