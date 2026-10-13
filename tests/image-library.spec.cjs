const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Run against a local static server: node tests/image-library.spec.cjs
// Requires Playwright and Chromium; TEST_BASE_URL and CHROMIUM_PATH are optional.
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765';
const root = path.resolve(__dirname, '..');
const mock = fs.readFileSync(path.join(__dirname, 'firebase-mock.js'), 'utf8');
const tinySvg = (color, w, h) => 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${color}"/><circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 4}" fill="white"/></svg>`).toString('base64');
const sourceA = tinySvg('#ad5e3b', 400, 200), sourceB = tinySvg('#517d74', 180, 300), sourceC = tinySvg('#807baa', 300, 300);
const image = (id, src, label) => ({ id, type: 'image', src, label, x: 30, y: 30, w: 240, h: 180, z: 1 });
const seed = {
  directory: { ROOMAA: { name: 'Memory', names: 'A, B' }, ROOMBB: { name: 'Place', names: 'C, D' } },
  rooms: {
    ROOMAA: { meta: { name: 'Memory' }, boards: { a: { name: 'Traces', bg: '#141414', order: 1 }, extra: { name: 'Empty board', order: 2 } }, items: { a: { one: image('one', sourceA, 'Rust and memory'), two: image('two', sourceB, 'Tall doorway') } } },
    ROOMBB: { meta: { name: 'Place' }, boards: { b: { name: 'Places', bg: '#141414', order: 1 } }, items: { b: { three: image('three', sourceA, 'Shared rust'), four: image('four', sourceC, '<img src=x onerror=alert(1)>') } } }
  }
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(data => { window.__firebaseSeed = data; }, seed);
    await context.route('https://www.gstatic.com/firebasejs/**', async route => route.fulfill({ contentType: 'application/javascript', body: route.request().url().includes('firebase-app-compat') ? mock : '' }));
    await context.route('https://cdnjs.cloudflare.com/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await context.route('https://fonts.**', route => route.abort());
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    assert.equal(await page.evaluate(async () => {
      Live.init(); let initial;
      await Live.db.ref('rooms/ROOMAA').transaction(current => { initial = current; });
      return initial;
    }), null, 'models an existing room with a cold transaction cache');
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await page.waitForFunction(() => Library.complete() && Library.entries.size === 3);
    await page.locator('.library-image').nth(2).waitFor();
    assert.equal(await page.locator('.library-image').count(), 3, 'deduplicates images across rooms');
    assert.equal(await page.evaluate(() => __firebaseData().rooms.ROOMAA.meta.libraryVersion), 1, 'backfills legacy rooms');
    assert.equal(await page.evaluate(() => ImageCatalog.migrations.size), 0, 'backfill releases its temporary state');
    assert.equal(await page.evaluate(() => document.querySelector('.library-image-title img') !== null), false, 'labels are rendered as text');
    const hashA = await page.evaluate(src => ImageCatalog.hash(src), sourceA);
    const hashB = await page.evaluate(src => ImageCatalog.hash(src), sourceB);
    await page.locator(`[data-select="${hashA}"]`).check();
    await page.locator('#library-room').selectOption('ROOMAA');
    await page.locator(`[data-select="${hashB}"]`).check();
    await page.locator('#library-search').fill('doorway');
    assert.equal(await page.locator('.library-image').count(), 1, 'filters labels within a selected room');
    assert.equal(await page.locator('#library-selected').textContent(), '2 selected', 'selection survives filters');
    await page.locator('#library-search').fill('');
    await page.locator('#library-room').selectOption('');
    await page.locator(`[data-preview="${hashA}"]`).click();
    await page.waitForFunction(() => !document.getElementById('library-preview-image').hidden);
    assert.equal(await page.locator('#library-preview-image').getAttribute('src'), sourceA, 'preview fetches full source');
    await page.locator('#library-preview-close').click();
    fs.mkdirSync('/tmp/constellation-review', { recursive: true });
    const buttonColor = await page.locator('#library-create').evaluate(el => getComputedStyle(el).color);
    assert.equal(buttonColor, 'rgb(15, 15, 15)', 'creation button uses a readable dark foreground');
    await page.locator('#library-create').hover();
    assert.equal(await page.locator('#library-create').evaluate(el => getComputedStyle(el).color), buttonColor, 'hover retains the readable foreground');
    await page.mouse.move(0, 0);
    if (process.env.CAPTURE_REVIEW) await page.screenshot({ path: '/tmp/constellation-review/desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    if (process.env.CAPTURE_REVIEW) await page.screenshot({ path: '/tmp/constellation-review/mobile.png', fullPage: true });
    assert.equal(await page.evaluate(() => document.getElementById('image-library').scrollWidth > document.getElementById('image-library').clientWidth), false, 'mobile gallery has no horizontal overflow');
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.getByRole('button', { name: 'Create master board', exact: true }).click();
    await page.locator('#library-master-name').fill('Class synthesis');
    await page.locator('#library-master-names').fill('Whole class');
    await page.locator('#library-master-submit').click();
    await page.waitForFunction(() => liveMode && Live.info.name === 'Class synthesis' && nodes.length === 2);
    const masterCode = await page.evaluate(() => Live.code);
    const master = await page.evaluate(code => __firebaseData().rooms[code], masterCode);
    assert.equal(Object.keys(master.boards).length, 1, 'creates one board in a new shared room');
    assert.equal(Object.values(Object.values(master.items)[0]).length, 2, 'copies only selected images');
    assert.equal(Object.values(master.items)[0].one, undefined, 'copies have fresh item IDs');
    const copiedTall = Object.values(Object.values(master.items)[0]).find(item => item.src === sourceB);
    assert.ok(Math.abs(copiedTall.h / copiedTall.w - 300 / 180) < .001, 'master grid preserves intrinsic aspect ratio');
    assert.deepEqual(await page.evaluate(() => __firebaseData().rooms.ROOMAA.items.a), seed.rooms.ROOMAA.items.a, 'source boards are unchanged');
    await page.reload();
    await page.waitForFunction(code => liveMode && Live.code === code && nodes.length === 2, masterCode);
    assert.equal(await page.locator('.img-node').count(), 2, 'shared master reopens from its room URL');
    const downloadReady = page.waitForEvent('download');
    await page.locator('#export-board-btn').click();
    const download = await downloadReady;
    const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.equal(exported.items.length, 2, 'master JSON export contains the selected images');
    assert.ok(exported.items.every(item => [sourceA, sourceB].includes(item.src)), 'JSON export retains full pixels');

    await page.locator('#library-btn').click();
    await page.waitForFunction(() => Library.complete() && Library.entries.size === 3);
    const readsBefore = await page.evaluate(() => __firebaseReads.slice());
    assert.equal(readsBefore.some(read => /^rooms\/[^/]+$/.test(read)), false, 'indexed rooms avoid full room downloads');
    const peer = await context.newPage();
    await peer.goto(base + '/?room=ROOMAA');
    await peer.waitForFunction(() => liveMode && activeBoardId === 'a' && nodes.length === 2);
    await peer.evaluate(() => { const el = nodeById('two'); el.querySelector('.img-label').textContent = 'Renamed doorway'; notifyNodeChanged(el); });
    await page.waitForFunction(hash => Library.entries.get(hash).sources.some(source => source.label === 'Renamed doorway'), hashB);
    await peer.evaluate(src => makeImageNode(src, 'New class image'), tinySvg('#bb8f37', 200, 200));
    await page.waitForFunction(() => Library.entries.size === 4);
    await peer.evaluate(() => { const el = nodes.find(n => n.querySelector('.img-label')?.textContent === 'New class image'); const id = el.dataset.id; removeNodeEl(el); Live.removeItem(id); });
    await page.waitForFunction(() => Library.entries.size === 3);
    await peer.close();
    await page.evaluate(() => __firebaseUpdate({ 'rooms/ROOMAA/items/a/one': null, 'rooms/ROOMAA/imageLibrary/a/one': null, 'rooms/ROOMBB/items/b/three': null, 'rooms/ROOMBB/imageLibrary/b/three': null }));
    await page.waitForFunction(hash => Library.entries.get(hash).sources.length === 1, hashA);
    assert.equal(await page.evaluate(hash => Library.entries.get(hash).sources[0].code, hashA), masterCode, 'image remains while used on a master board');
    await page.evaluate(({ code, hash }) => {
      const boardId = Object.keys(__firebaseData().rooms[code].boards)[0];
      const id = Object.entries(__firebaseData().rooms[code].imageLibrary[boardId]).find(([, value]) => value.hash === hash)[0];
      return __firebaseUpdate({ [`rooms/${code}/items/${boardId}/${id}`]: null, [`rooms/${code}/imageLibrary/${boardId}/${id}`]: null });
    }, { code: masterCode, hash: hashA });
    await page.waitForFunction(hash => !Library.entries.has(hash), hashA);

    await page.locator('#library-close').click();
    await page.evaluate(() => makeImageNode('data:image/png;base64,broken', 'Broken test'));
    await page.waitForFunction(() => Object.values(__firebaseData().rooms[Live.code].imageLibrary[activeBoardId]).some(item => item.label === 'Broken test'));
    await page.evaluate(() => { const el = nodes.find(n => n.querySelector('.img-label')?.textContent === 'Broken test'); const id = el.dataset.id; removeNodeEl(el); Live.removeItem(id); });
    await page.waitForFunction(() => !Object.values(__firebaseData().rooms[Live.code].imageLibrary[activeBoardId]).some(item => item.label === 'Broken test'));
    const beforeDuplicate = await page.evaluate(() => Object.keys(__firebaseData().rooms[Live.code].boards).length);
    await page.evaluate(() => Live.duplicateBoard());
    assert.equal(await page.evaluate(() => Object.keys(__firebaseData().rooms[Live.code].boards).length), beforeDuplicate + 1, 'duplicates create indexed boards');
    await page.evaluate(() => Live.importBoards([{ name: 'Imported images', items: [{ id: 'imported', type: 'image', src: 'data:image/png;base64,broken', label: 'Imported', x: 0, y: 0, w: 240, h: 180 }] }]));
    await page.waitForFunction(() => Object.values(__firebaseData().rooms[Live.code].imageLibrary[activeBoardId] || {}).some(item => item.label === 'Imported'));
    await page.evaluate(() => { clearNodes(); Live.clearItems(); });
    await page.waitForFunction(() => !__firebaseData().rooms[Live.code].imageLibrary[activeBoardId]);
    await page.evaluate(() => Live.deleteBoard(activeBoardId));
    await page.waitForFunction(() => nodes.length === 1);

    await page.locator('#library-btn').click();
    await page.waitForFunction(() => Library.complete());
    await page.locator(`[data-select="${hashB}"]`).check();
    await page.locator('#library-create').click();
    await page.locator('#library-master-name').fill('Retry master');
    await page.evaluate(() => { window.__firebaseFailWrites = true; });
    await page.locator('#library-master-submit').click();
    await page.waitForFunction(() => !Library.busy && document.getElementById('library-master-error').textContent.includes('Connection interrupted'));
    assert.equal(await page.evaluate(() => Library.selected.size), 1, 'save failure preserves selection');
    await page.evaluate(() => { window.__firebaseFailWrites = false; });
    await page.locator('#library-master-submit').click();
    await page.waitForFunction(() => liveMode && Live.info.name === 'Retry master' && nodes.length === 1);

    await page.locator('#library-btn').click();
    await page.waitForFunction(() => Library.complete());
    await page.locator(`[data-select="${hashB}"]`).check();
    await page.locator('#library-create').click();
    await page.locator('#library-master-name').fill('Saved retry');
    const roomCountBefore = await page.evaluate(() => Object.keys(__firebaseData().rooms).length);
    await page.evaluate(() => { window.__firebaseDenyNextJoin = true; });
    await page.locator('#library-master-submit').click();
    await page.waitForFunction(() => !Library.busy && Library.createdRoom !== null);
    const savedCode = await page.evaluate(() => Library.createdRoom.code);
    assert.equal(await page.evaluate(() => Object.keys(__firebaseData().rooms).length), roomCountBefore + 1);
    await page.locator('#library-master-submit').click();
    await page.waitForFunction(code => Live.code === code && nodes.length === 1, savedCode);
    assert.equal(await page.evaluate(() => Object.keys(__firebaseData().rooms).length), roomCountBefore + 1, 'opening retry does not create a duplicate room');

    // Backfill must abort a stale transaction and retry after concurrent removal.
    await page.evaluate(src => {
      const room = { meta: { name: 'Legacy race' }, boards: { race: { name: 'Race', order: 1 } }, items: { race: { keep: { id: 'keep', type: 'image', src, label: 'keep' }, gone: { id: 'gone', type: 'image', src, label: 'gone' } } } };
      return __firebaseUpdate({ 'rooms/RACEAA': room });
    }, sourceA);
    await page.evaluate(() => {
      window.__firebaseBeforeTransaction = () => __firebaseUpdate({ 'rooms/RACEAA/items/race/gone': null });
      return ImageCatalog.ensureRoom(Live.db.ref('rooms/RACEAA'));
    });
    assert.equal(await page.evaluate(() => !!__firebaseData().rooms.RACEAA.imageLibrary.race.gone), false, 'backfill cannot resurrect a concurrently removed image');
    assert.equal(await page.evaluate(() => !!__firebaseData().rooms.RACEAA.imageLibrary.race.keep), true);

    // An unrelated unreadable room must not block creation from readable sources.
    await page.evaluate(() => { window.__firebaseDenied = ['rooms/ROOMBB/imageLibrary']; });
    await page.locator('#library-btn').click();
    await page.waitForFunction(() => Library.settled() && Library.rooms.get('ROOMBB').error);
    await page.waitForFunction(() => document.getElementById('library-status').textContent.includes('Could not load: Place'));
    await page.locator(`[data-select="${hashB}"]`).check();
    assert.equal(await page.locator('#library-create').isEnabled(), true, 'partial room failure allows selection from available rooms');
    assert.ok((await page.locator('#library-status').textContent()).includes('Could not load: Place'), 'partial failure names the room');
    await page.evaluate(() => { window.__firebaseDenied = []; });
    await page.locator('#library-refresh').click();
    await page.waitForFunction(() => Library.complete());
    assert.deepEqual(errors, [], 'no browser JavaScript errors');
    console.log('PASS: library backfill, deduplication, filters, preview, cross-filter selection, responsive layout, shared master persistence and JSON export, cross-browser live edits, current usage, broken images, imports, duplicates, clearing, deleting, save/open retries, concurrent backfill, and partial-room errors.');
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
