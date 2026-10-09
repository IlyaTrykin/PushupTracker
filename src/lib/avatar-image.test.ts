import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { AVATAR_SIZE, AvatarImageError, detectImageFormat, normalizeAvatarImage } from './avatar-image';

const solid = () => sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 200, g: 40, b: 40 } } });

test('known image signatures are recognised', async () => {
  assert.equal(detectImageFormat(await solid().jpeg().toBuffer()), 'jpeg');
  assert.equal(detectImageFormat(await solid().png().toBuffer()), 'png');
  assert.equal(detectImageFormat(await solid().webp().toBuffer()), 'webp');
  assert.equal(detectImageFormat(await solid().gif().toBuffer()), 'gif');
});

test('HTML, SVG and truncated files are not images', () => {
  const html = Buffer.from('<!doctype html><html><script>alert(1)</script></html>');
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
  const riffNotWebp = Buffer.from('RIFF\x00\x00\x00\x00WAVEfmt ', 'latin1');
  assert.equal(detectImageFormat(html), null);
  assert.equal(detectImageFormat(svg), null);
  assert.equal(detectImageFormat(riffNotWebp), null);
  assert.equal(detectImageFormat(Buffer.from([0xff, 0xd8])), null);
  assert.equal(detectImageFormat(Buffer.alloc(0)), null);
});

test('an HTML file is refused by normalizeAvatarImage', async () => {
  const html = Buffer.from('<!doctype html><html><body>hi</body></html>');
  await assert.rejects(() => normalizeAvatarImage(html), AvatarImageError);
});

test('a photo with EXIF becomes a 256×256 WebP without metadata', async () => {
  const input = await solid()
    .withMetadata({ exif: { IFD0: { Copyright: 'secret-gps-owner' } } })
    .jpeg()
    .toBuffer();
  assert.ok((await sharp(input).metadata()).exif, 'fixture must carry EXIF');

  const out = await normalizeAvatarImage(input);
  const meta = await sharp(out).metadata();
  assert.equal(detectImageFormat(out), 'webp');
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, AVATAR_SIZE);
  assert.equal(meta.height, AVATAR_SIZE);
  assert.equal(AVATAR_SIZE, 256);
  assert.equal(meta.exif, undefined);
  assert.equal(meta.icc, undefined);
  assert.equal(out.includes(Buffer.from('secret-gps-owner')), false);
});

test('a polyglot with an image header but broken body is refused', async () => {
  const fake = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('<html>not a png</html>')]);
  assert.equal(detectImageFormat(fake), 'png');
  await assert.rejects(() => normalizeAvatarImage(fake), AvatarImageError);
});
