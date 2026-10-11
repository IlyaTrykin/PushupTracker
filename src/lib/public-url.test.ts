import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicAppUrl } from './public-url';

function withAppUrl(value: string | undefined, fn: () => void) {
  const prev = process.env.APP_URL;
  if (value === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = prev;
  }
}

test('publicAppUrl trims trailing slashes', () => {
  withAppUrl(' https://example.com/// ', () => assert.equal(publicAppUrl(), 'https://example.com'));
});

test('publicAppUrl is null when unset or not http(s)', () => {
  withAppUrl(undefined, () => assert.equal(publicAppUrl(), null));
  withAppUrl('example.com', () => assert.equal(publicAppUrl(), null));
  withAppUrl('javascript:alert(1)', () => assert.equal(publicAppUrl(), null));
});
