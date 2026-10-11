import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INVITE_CODE_LENGTH,
  generateInviteCode,
  normalizeInviteCode,
  parseSignupAttribution,
  signupSourceLabel,
} from './referral';

test('generateInviteCode makes 8 unambiguous lowercase chars that normalize back to themselves', () => {
  for (let i = 0; i < 200; i++) {
    const code = generateInviteCode();
    assert.equal(code.length, INVITE_CODE_LENGTH);
    assert.doesNotMatch(code, /[01oil]/);
    assert.equal(normalizeInviteCode(code), code);
  }
});

test('normalizeInviteCode accepts case/space variants and rejects junk', () => {
  assert.equal(normalizeInviteCode(' ABCD2345 '), 'abcd2345');
  assert.equal(normalizeInviteCode('abcd234'), null);
  assert.equal(normalizeInviteCode('abcd2340'), null);
  assert.equal(normalizeInviteCode('<script>'), null);
  assert.equal(normalizeInviteCode(42), null);
});

test('parseSignupAttribution keeps clean utm/ref and drops the rest', () => {
  const a = parseSignupAttribution({
    invite: 'ABCD2345',
    ref: 'Habr',
    utm: { utm_source: 'Telegram', utm_medium: 'post', utm_campaign: '<bad>', other: 'x' },
  });
  assert.deepEqual(a, { inviteCode: 'abcd2345', ref: 'habr', utm: { utm_source: 'telegram', utm_medium: 'post' } });
  assert.deepEqual(parseSignupAttribution(null), { inviteCode: null, ref: null, utm: null });
  assert.deepEqual(parseSignupAttribution('x'), { inviteCode: null, ref: null, utm: null });
});

test('signupSourceLabel prefers an accepted invite, then utm, then ref', () => {
  const a = parseSignupAttribution({ invite: 'abcd2345', ref: 'vk', utm: { utm_source: 'tg' } });
  assert.equal(signupSourceLabel(a, true), 'invite');
  assert.equal(signupSourceLabel(a, false), 'utm:tg');
  assert.equal(signupSourceLabel(parseSignupAttribution({ ref: 'vk' }), false), 'ref:vk');
  assert.equal(signupSourceLabel(parseSignupAttribution({}), false), 'direct');
});
