// Run against npm run dev with an existing Playwright installation and browser.
// PLAYWRIGHT_MODULE=<module path> CDP_URL=http://localhost:9225 node scripts/check-ui.cjs
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://localhost:9225');
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, locale: 'zh-CN' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.dismiss());
  const check = async (label, test) => {
    await test();
    console.log('PASS', label);
  };
  const settle = () => page.waitForTimeout(650);
  const mode = index => page.locator('.view-switcher button').nth(index).click();
  const seed = () => page.evaluate(async () => {
    const { useDocStore } = await import('/src/store/docStore.ts');
    window.reviewStore = useDocStore;
    const store = useDocStore.getState();
    store.setRoot('/review', ['README.md', 'notes.md'].map(name => ({ name, path: '/review/' + name, isDirectory: false })));
    const content = '# 阅读与标注\n\nhello world\n\n' + Array.from({ length: 15 }, (_, i) => `## 第 ${i + 1} 节\n\n这是用于检查分栏、滚动和中文排版的正文。\n\n\`\`\`js\nconst section = ${i};\n\`\`\`\n\n`).join('');
    store.openDoc('/review/notes.md', '# Notes\n\nSecond document');
    store.openDoc('/review/README.md', content);
  });
  const state = () => page.evaluate(() => {
    const s = window.reviewStore.getState();
    return { docs: s.docs, panes: s.previewPanes, active: s.activeId };
  });
  async function drag(selector, delta, storageKey, direction = 1) {
    const handle = page.locator(selector).first();
    const box = await handle.boundingBox();
    assert(box, selector + ' visible');
    const before = await page.evaluate(key => Number(localStorage.getItem(key)), storageKey);
    // Outline handles are partly clipped by their existing parent; use the visible edge.
    const x = selector.includes('outline') ? box.x + box.width - 1 : box.x + box.width / 2;
    await page.mouse.move(x, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(x + delta, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    const after = await page.evaluate(key => Number(localStorage.getItem(key)), storageKey);
    assert((after - before) * direction > 0, selector + ' updates stored size');
    await page.mouse.move(x + delta + 20, box.y + box.height / 2);
    assert.equal(await page.evaluate(key => Number(localStorage.getItem(key)), storageKey), after, 'mouseup stops resize');
  }
  try {
    await page.goto(process.env.APP_URL || 'http://127.0.0.1:1420');
    await page.locator('.app').waitFor();
    await seed();
    await settle();
    await check('text annotation, recolor, clear and focus', async () => {
      const editor = page.locator('textarea.editor');
      await editor.evaluate(el => { el.focus(); const start = el.value.indexOf('world'); el.setSelectionRange(start, start + 5); });
      await editor.press('Shift+F10');
      await page.locator('.color-section').first().locator('button').first().click();
      await settle();
      assert.equal(await page.locator('.markdown-body .wr-text-red').textContent(), 'world');
      assert(await editor.evaluate(el => document.activeElement === el && el.value.slice(el.selectionStart, el.selectionEnd).includes('world')));
      await editor.press('Shift+F10');
      await page.locator('.color-section').nth(1).locator('button').first().click();
      await settle();
      assert.equal(await page.locator('.markdown-body .wr-bg-yellow').textContent(), 'world');
      assert.equal(await page.locator('.markdown-body .wr-bg-yellow').evaluate(el => getComputedStyle(el).color), await page.locator('.markdown-body').evaluate(el => getComputedStyle(el).color));
      await editor.press('Shift+F10');
      await page.getByRole('menuitem', { name: '清除颜色' }).click();
      await settle();
      assert((await editor.inputValue()).includes('hello world'));
      assert.equal(await page.locator('.markdown-body mark, .markdown-body .wr-text-red').count(), 0);
      await editor.evaluate(el => { const start = el.value.indexOf('world'); el.setSelectionRange(start, start + 5); });
      const rect = await editor.boundingBox();
      await editor.dispatchEvent('contextmenu', { clientX: rect.x + 40, clientY: rect.y + 40, button: 2 });
      await page.locator('.color-section').first().locator('button').first().click();
      await settle();
      assert.equal(await page.locator('.markdown-body .wr-text-red').textContent(), 'world');
    });
    await check('sidebar, outline and editor/preview resize', async () => {
      await drag('.sidebar-resizer', 25, 'win-readme-sidebar-width');
      await drag('.outline-resizer', -20, 'win-readme-outline-width');
      await drag('.pane-resizer', 30, 'win-readme-split-ratio');
    });
    await check('outline navigation and scroll synchronization', async () => {
      await page.locator('.outline-list button').nth(5).click();
      await settle();
      assert(await page.locator('textarea.editor').evaluate(el => el.scrollTop > 0));
      assert(await page.locator('.preview-scroll').evaluate(el => el.scrollTop > 0));
      await page.locator('textarea.editor').evaluate(el => { el.scrollTop = 200; });
      await settle();
      assert(await page.locator('.preview-scroll').evaluate(el => el.scrollTop > 0));
    });
    await check('preview split, resize, cross-pane drag and close split', async () => {
      await mode(2);
      await settle();
      await page.locator('.tab').filter({ hasText: 'README.md' }).click({ button: 'right' });
      await page.getByRole('menuitem', { name: '向右拆分' }).click();
      await settle();
      assert.equal(await page.locator('.preview-pane').count(), 2);
      await drag('.pane-resizer', 30, 'win-readme-preview-split-ratio');
      await page.locator('.tab').filter({ hasText: 'README.md' }).dragTo(page.locator('.preview-pane').first());
      await settle();
      const moved = await state();
      assert(moved.panes[0].tabs.includes('/review/README.md'));
      assert.equal(moved.panes[1].tabs.length, 0);
      assert(moved.docs.find(d => d.name === 'README.md').dirty);
      await page.locator('.tab').filter({ hasText: 'README.md' }).click({ button: 'right' });
      await page.getByRole('menuitem', { name: '关闭拆分' }).click();
      assert.equal(await page.locator('.preview-pane').count(), 1);
    });
    await check('unsaved close cancellation and view switching', async () => {
      await page.locator('.tab').filter({ hasText: 'README.md' }).locator('.close').click();
      assert((await state()).docs.some(d => d.name === 'README.md' && d.dirty));
      await mode(0);
      assert.equal(await page.locator('textarea.editor').count(), 1);
      assert.equal(await page.locator('.preview-scroll').count(), 0);
      await mode(1);
      await settle();
    });
    await check('narrow and wide viewport, collapsed panels', async () => {
      for (const width of [800, 1200, 1600]) {
        await page.setViewportSize({ width, height: 800 });
        await settle();
        assert(await page.locator('textarea.editor').isVisible());
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (process.env.SCREENSHOT) await page.screenshot({ path: process.env.SCREENSHOT.replace(/\.png$/, `-${width}.png`) });
      }
      await page.getByRole('button', { name: '收起大纲', exact: true }).click();
      await page.getByRole('button', { name: '收起侧边栏', exact: true }).click();
      await page.setViewportSize({ width: 800, height: 800 });
      await settle();
      assert((await page.locator('.preview-scroll').boundingBox()).width > 280);
      if (process.env.SCREENSHOT) await page.screenshot({ path: process.env.SCREENSHOT.replace(/\.png$/, '-800-focused.png') });
      await page.getByRole('button', { name: '展开大纲', exact: true }).click();
      await page.getByRole('button', { name: '展开侧边栏', exact: true }).click();
      await page.setViewportSize({ width: 1200, height: 800 });
    });
    await check('layout preferences survive reload', async () => {
      const width = await page.locator('.sidebar-wrap').evaluate(el => el.style.width);
      const preferences = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('win-readme-'))));
      await page.evaluate(() => window.reviewStore.getState().docs.forEach(d => window.reviewStore.getState().markClean(d.id, d.content)));
      await page.reload();
      await seed();
      await settle();
      assert.equal(await page.locator('.sidebar-wrap').evaluate(el => el.style.width), width);
      assert.deepEqual(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('win-readme-')))), preferences);
    });
    await check('save IPC, failed-save dirty state and retry (mock filesystem)', async () => {
      await page.evaluate(() => {
        window.savedReview = null;
        window.failReviewSave = true;
        window.__TAURI_INTERNALS__ = { invoke: async (command, bytes, options) => {
          if (command !== 'plugin:fs|write_text_file') throw new Error('Unexpected IPC: ' + command);
          if (window.failReviewSave) throw new Error('Test write failure');
          window.savedReview = { path: decodeURIComponent(options.headers.path), content: new TextDecoder().decode(bytes) };
        }};
      });
      const editor = page.locator('textarea.editor');
      await editor.evaluate(el => { el.focus(); const start = el.value.indexOf('world'); el.setSelectionRange(start, start + 5); });
      await editor.press('Shift+F10');
      await page.locator('.color-section').nth(1).locator('button').first().click();
      await page.locator('.save-button').click();
      await settle();
      assert((await state()).docs.find(d => d.name === 'README.md').dirty);
      await page.evaluate(() => { window.failReviewSave = false; });
      await editor.press('Control+s');
      await settle();
      const saved = await page.evaluate(() => window.savedReview);
      assert.equal(saved.path, '/review/README.md');
      assert(saved.content.includes('<mark'));
      assert.equal((await state()).docs.find(d => d.name === 'README.md').dirty, false);
      await page.evaluate(() => {
        const s = window.reviewStore.getState();
        s.closeDoc('/review/README.md');
        s.openDoc(window.savedReview.path, window.savedReview.content);
      });
      await settle();
      assert.equal(await page.locator('.markdown-body .wr-bg-yellow').textContent(), 'world');
    });
    if (process.env.SCREENSHOT) await page.screenshot({ path: process.env.SCREENSHOT });
    await check('preview typography and dark code blocks', async () => {
      await mode(2);
      await settle();
      const color = await page.locator('.markdown-body pre.shiki').first().evaluate(el => getComputedStyle(el).backgroundColor);
      assert.notEqual(color, 'rgb(255, 255, 255)');
      if (process.env.SCREENSHOT) await page.screenshot({ path: process.env.SCREENSHOT.replace(/\.png$/, '-reading.png') });
    });
    await check('empty-state file and folder actions (mock dialogs)', async () => {
      await page.evaluate(() => {
        const s = window.reviewStore.getState();
        s.docs.forEach(d => s.closeDoc(d.id));
        s.removeRoot('/review');
        window.dialogCalls = [];
        window.__TAURI_INTERNALS__.invoke = async (command, args) => {
          if (command !== 'plugin:dialog|open') throw new Error('Unexpected IPC: ' + command);
          window.dialogCalls.push(args.options);
          return null;
        };
      });
      await page.locator('.empty-action').click();
      await page.locator('.sidebar-open').click();
      assert.deepEqual(await page.evaluate(() => window.dialogCalls.map(o => Boolean(o.directory))), [false, true]);
      if (process.env.SCREENSHOT) await page.screenshot({ path: process.env.SCREENSHOT.replace(/\.png$/, '-empty.png') });
    });
    assert.deepEqual(errors, [], 'No uncaught page errors');
  } catch (error) {
    console.error('Page errors:', errors);
    console.error('Page content:', (await page.locator('body').innerText()).slice(0,1200));
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
