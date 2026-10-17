import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendQuery,
  challengeHref,
  groupHref,
  groupMemberHref,
  linkHref,
  programHref,
  programSessionHref,
  toAppRoute,
} from './app-routes';

test('web addresses stay exactly as the site has them', () => {
  assert.equal(groupHref('g1', undefined, 'web'), '/groups/g1');
  assert.equal(groupHref('g1', 'members', 'web'), '/groups/g1/members');
  assert.equal(groupHref('g1', 'challenges', 'web'), '/groups/g1/challenges');
  assert.equal(groupHref('g1', 'manage', 'web'), '/groups/g1/manage');
  assert.equal(groupMemberHref('g1', 'u2', 'web'), '/groups/g1/members/u2');
  assert.equal(challengeHref('c1', 'web'), '/challenges/c1');
  assert.equal(programHref('p1', 'web'), '/program/p1');
  assert.equal(programSessionHref('s1', 'web'), '/program/session/s1');
});

test('app addresses carry ids in the query', () => {
  assert.equal(groupHref('g1', undefined, 'native'), '/groups/view?id=g1');
  assert.equal(groupHref('g1', 'members', 'native'), '/groups/view?id=g1&tab=members');
  assert.equal(groupHref('g1', 'manage', 'native'), '/groups/view?id=g1&tab=manage');
  assert.equal(groupMemberHref('g1', 'u2', 'native'), '/groups/member?id=g1&userId=u2');
  assert.equal(challengeHref('c1', 'native'), '/challenges/view?id=c1');
  assert.equal(programHref('p1', 'native'), '/program/view?id=p1');
  assert.equal(programSessionHref('s1', 'native'), '/program/session?id=s1');
});

test('ids are encoded in both targets', () => {
  assert.equal(challengeHref('a b/c', 'web'), '/challenges/a%20b%2Fc');
  assert.equal(challengeHref('a b/c', 'native'), '/challenges/view?id=a+b%2Fc');
});

test('without a target the site form is used outside the app build', () => {
  assert.equal(challengeHref('c1'), '/challenges/c1');
  assert.equal(groupHref('g1'), '/groups/g1');
});

test('appendQuery joins with ? or & and skips an empty query', () => {
  assert.equal(appendQuery('/groups/g1/members/u2', 'period=7d'), '/groups/g1/members/u2?period=7d');
  assert.equal(appendQuery('/groups/member?id=g1&userId=u2', 'period=7d'), '/groups/member?id=g1&userId=u2&period=7d');
  assert.equal(appendQuery('/groups/g1', ''), '/groups/g1');
  assert.equal(appendQuery('/groups/g1', new URLSearchParams({ exercise: 'squats' })), '/groups/g1?exercise=squats');
});

test('toAppRoute translates every Notification.link form', () => {
  assert.equal(toAppRoute('/challenges/c1'), '/challenges/view?id=c1');
  assert.equal(toAppRoute('/challenges?invite=c1'), '/challenges?invite=c1');
  assert.equal(toAppRoute('/groups/g1'), '/groups/view?id=g1');
  assert.equal(toAppRoute('/groups/g1/members'), '/groups/view?id=g1&tab=members');
  assert.equal(toAppRoute('/groups/g1/challenges'), '/groups/view?id=g1&tab=challenges');
  assert.equal(toAppRoute('/groups/g1/manage'), '/groups/view?id=g1&tab=manage');
  assert.equal(toAppRoute('/groups/g1/members/u2'), '/groups/member?id=g1&userId=u2');
  assert.equal(toAppRoute('/program/p1'), '/program/view?id=p1');
  assert.equal(toAppRoute('/program/session/s1'), '/program/session?id=s1');
  assert.equal(toAppRoute('/program'), '/program');
  assert.equal(toAppRoute('/program?stoppedProgram=p1'), '/program?stoppedProgram=p1');
  assert.equal(toAppRoute('/friends'), '/friends');
  assert.equal(toAppRoute('/dashboard'), '/dashboard');
  assert.equal(toAppRoute('/groups?invite=tok'), '/groups?invite=tok');
});

test('toAppRoute keeps the query and hash', () => {
  assert.equal(toAppRoute('/challenges/abc?x=1'), '/challenges/view?id=abc&x=1');
  assert.equal(toAppRoute('/groups/g1/members/u2?period=7d&exercise=squats'), '/groups/member?id=g1&userId=u2&period=7d&exercise=squats');
  assert.equal(toAppRoute('/program/session/s1#top'), '/program/session?id=s1#top');
  assert.equal(toAppRoute('/challenges/c1/'), '/challenges/view?id=c1');
});

test('toAppRoute decodes the path segment once', () => {
  assert.equal(toAppRoute('/challenges/a%20b'), '/challenges/view?id=a+b');
});

test('toAppRoute leaves app routes, unknown paths and absolute URLs alone', () => {
  assert.equal(toAppRoute('/challenges/view?id=c1'), '/challenges/view?id=c1');
  assert.equal(toAppRoute('/groups/view?id=g1&tab=members'), '/groups/view?id=g1&tab=members');
  assert.equal(toAppRoute('/groups/member?id=g1&userId=u2'), '/groups/member?id=g1&userId=u2');
  assert.equal(toAppRoute('/program/view?id=p1'), '/program/view?id=p1');
  assert.equal(toAppRoute('/program/session?id=s1'), '/program/session?id=s1');
  assert.equal(toAppRoute('/groups/g1/unknown'), '/groups/g1/unknown');
  assert.equal(toAppRoute('/invite/abcd'), '/invite/abcd');
  assert.equal(toAppRoute('https://example.test/challenges/c1'), 'https://example.test/challenges/c1');
  assert.equal(toAppRoute(''), '');
});

test('linkHref opens a server link as is on the site and as an app route in the app', () => {
  assert.equal(linkHref('/challenges/c1', 'web'), '/challenges/c1');
  assert.equal(linkHref('/challenges/c1', 'native'), '/challenges/view?id=c1');
  assert.equal(linkHref('/friends', 'native'), '/friends');
});
