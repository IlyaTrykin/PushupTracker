import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { APP_BUILD, APP_VERSION } from './app-version';
import packageJson from '../../package.json';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('website and mobile app version settings stay aligned', () => {
  const packageLock = JSON.parse(read('package-lock.json')) as {
    version: string;
    packages: { '': { version: string } };
  };
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[''].version, packageJson.version);

  const xcode = read('ios/App/App.xcodeproj/project.pbxproj');
  const marketingVersions = [...xcode.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((match) => match[1]);
  const buildNumbers = [...xcode.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)].map((match) => Number(match[1]));
  assert.equal(marketingVersions.length, 2);
  assert.deepEqual(marketingVersions, [APP_VERSION, APP_VERSION]);
  assert.equal(buildNumbers.length, 2);
  assert.deepEqual(buildNumbers, [APP_BUILD, APP_BUILD]);

  const android = read('android/app/build.gradle');
  assert.match(android, /versionCode appBuild/);
  assert.match(android, /versionName appVersionName/);
  assert.match(android, /appMajor \* 10000 \+ appMinor \* 100 \+ appPatch/);
});
