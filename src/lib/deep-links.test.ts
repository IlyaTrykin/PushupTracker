import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAppleAppSiteAssociation, buildAssetLinks, hostOf, resolveDeepLink } from './deep-links';

const HOST = 'tracker.example.org';

test('invite link opens registration with the code', () => {
  assert.equal(resolveDeepLink(`https://${HOST}/invite/abcd2345`, HOST), '/register?invite=abcd2345');
  assert.equal(resolveDeepLink(`https://${HOST}/invite/abcd2345/`, HOST), '/register?invite=abcd2345');
});

test('group invite and password reset keep their query', () => {
  assert.equal(resolveDeepLink(`https://${HOST}/groups?invite=tok-123`, HOST), '/groups?invite=tok-123');
  assert.equal(resolveDeepLink(`https://${HOST}/reset-password?token=a1B2c3`, HOST), '/reset-password?token=a1B2c3');
});

test('foreign host, unknown path and missing parameters are ignored', () => {
  assert.equal(resolveDeepLink('https://evil.example.com/invite/abcd2345', HOST), null);
  assert.equal(resolveDeepLink(`https://${HOST}/admin/growth`, HOST), null);
  assert.equal(resolveDeepLink(`https://${HOST}/groups`, HOST), null);
  assert.equal(resolveDeepLink(`https://${HOST}/reset-password`, HOST), null);
  assert.equal(resolveDeepLink(`https://${HOST}/invite/`, HOST), null);
  assert.equal(resolveDeepLink('not a url', HOST), null);
  assert.equal(resolveDeepLink(`https://${HOST}/invite/abcd2345`, null), null);
  assert.equal(resolveDeepLink(`javascript://${HOST}/invite/abcd2345`, HOST), null);
});

test('port is part of the host (local debugging)', () => {
  assert.equal(resolveDeepLink('http://10.0.2.2:3100/invite/abcd2345', '10.0.2.2:3100'), '/register?invite=abcd2345');
  assert.equal(resolveDeepLink('http://10.0.2.2:3999/invite/abcd2345', '10.0.2.2:3100'), null);
});

test('codes with separators or encoded slashes are rejected', () => {
  assert.equal(resolveDeepLink(`https://${HOST}/invite/a%2Fb`, HOST), null);
  assert.equal(resolveDeepLink(`https://${HOST}/groups?invite=a%26b%3D1`, HOST), null);
});

test('hostOf extracts host with port from the server base', () => {
  assert.equal(hostOf('https://tracker.example.org/'), 'tracker.example.org');
  assert.equal(hostOf('http://10.0.2.2:3100'), '10.0.2.2:3100');
  assert.equal(hostOf(''), null);
  assert.equal(hostOf(undefined), null);
});

const SHA = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';

test('assetlinks: empty env gives null', () => {
  assert.equal(buildAssetLinks({}), null);
  assert.equal(buildAssetLinks({ ANDROID_APP_PACKAGE: 'app.x', ANDROID_CERT_SHA256: '' }), null);
  assert.equal(buildAssetLinks({ ANDROID_CERT_SHA256: 'not-a-fingerprint' }), null);
});

test('assetlinks: package and fingerprints from env', () => {
  const two = `${SHA.toLowerCase()}, ${SHA}`;
  assert.deepEqual(buildAssetLinks({ ANDROID_APP_PACKAGE: 'app.x', ANDROID_CERT_SHA256: two }), [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: 'app.x', sha256_cert_fingerprints: [SHA, SHA] },
    },
  ]);
  const byDefault = buildAssetLinks({ ANDROID_CERT_SHA256: SHA });
  assert.equal(byDefault?.[0].target.package_name, 'app.pushuptracker.mobile');
});

test('apple-app-site-association: needs team id', () => {
  assert.equal(buildAppleAppSiteAssociation({}), null);
  assert.equal(buildAppleAppSiteAssociation({ APPLE_TEAM_ID: 'bad id' }), null);
  assert.deepEqual(buildAppleAppSiteAssociation({ APPLE_TEAM_ID: 'ABCDE12345' }), {
    applinks: {
      details: [
        {
          appIDs: ['ABCDE12345.app.pushuptracker.mobile'],
          components: [
            { '/': '/invite/*' },
            { '/': '/groups', '?': { invite: '*' } },
            { '/': '/reset-password', '?': { token: '*' } },
          ],
        },
      ],
    },
  });
});
