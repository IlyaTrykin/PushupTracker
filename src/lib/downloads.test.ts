import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { downloadsDir, resolveDownload } from './downloads';

test('apk is served as an Android package', () => {
  assert.deepEqual(resolveDownload('pushup-tracker.apk'), {
    fileName: 'pushup-tracker.apk',
    contentType: 'application/vnd.android.package-archive',
  });
  assert.equal(resolveDownload('Pushup_Tracker-1.2.APK')?.contentType, 'application/vnd.android.package-archive');
});

test('traversal, hidden and temporary files are refused', () => {
  for (const name of ['../.env', '..apk', 'a/../b.apk', 'dir/app.apk', '.app.apk', '.app.apk.1a2b.tmp', '', 'a..apk']) {
    assert.equal(resolveDownload(name), null, name);
  }
});

test('only known file types are served', () => {
  for (const name of ['app.html', 'app.js', 'app.svg', 'app', 'app.apk.tmp']) {
    assert.equal(resolveDownload(name), null, name);
  }
});

test('downloads dir comes from env or defaults next to the app', () => {
  assert.equal(downloadsDir({ DOWNLOADS_DIR: '/data/dl' }), '/data/dl');
  assert.equal(downloadsDir({}), path.join(process.cwd(), 'downloads'));
});
