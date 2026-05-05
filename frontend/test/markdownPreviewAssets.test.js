import test from 'node:test';
import assert from 'node:assert/strict';
import {
  imageMimeForPath,
  isExternalMarkdownHref,
  isSafeExternalMarkdownHref,
  resolveMarkdownAssetPath,
  resolveMarkdownLinkPath,
} from '../src/ui/markdownPreviewAssets.js';

test('resolveMarkdownAssetPath resolves assets next to the markdown file', () => {
  assert.equal(resolveMarkdownAssetPath('README.md', 'surveycorps.png'), 'surveycorps.png');
  assert.equal(resolveMarkdownAssetPath('docs/README.md', '../assets/logo%20wide.png'), 'assets/logo wide.png');
  assert.equal(resolveMarkdownAssetPath('docs/guide/README.md', './images/shot.png?raw=1#hero'), 'docs/guide/images/shot.png');
});

test('resolveMarkdownAssetPath ignores external and escaping sources', () => {
  assert.equal(resolveMarkdownAssetPath('README.md', 'https://example.com/logo.png'), '');
  assert.equal(resolveMarkdownAssetPath('README.md', 'data:image/png;base64,abc'), '');
  assert.equal(resolveMarkdownAssetPath('README.md', '#section'), '');
  assert.equal(resolveMarkdownAssetPath('README.md', '../outside.png'), '');
});

test('resolveMarkdownAssetPath treats leading slash as workspace root', () => {
  assert.equal(resolveMarkdownAssetPath('docs/README.md', '/assets/logo.png'), 'assets/logo.png');
});

test('imageMimeForPath covers markdown preview image types', () => {
  assert.equal(imageMimeForPath('surveycorps.png'), 'image/png');
  assert.equal(imageMimeForPath('diagram.svg'), 'image/svg+xml');
  assert.equal(imageMimeForPath('photo.jpeg'), 'image/jpeg');
});

test('resolveMarkdownLinkPath resolves local links like image assets', () => {
  assert.equal(resolveMarkdownLinkPath('README.md', 'README.zh-TW.md'), 'README.zh-TW.md');
  assert.equal(resolveMarkdownLinkPath('docs/README.md', '../README.md#intro'), 'README.md');
  assert.equal(resolveMarkdownLinkPath('docs/guide.md', './topic.md?plain=1'), 'docs/topic.md');
});

test('markdown link helpers classify external links safely', () => {
  assert.equal(isExternalMarkdownHref('https://example.com'), true);
  assert.equal(isExternalMarkdownHref('mailto:hello@example.com'), true);
  assert.equal(isExternalMarkdownHref('README.md'), false);
  assert.equal(isSafeExternalMarkdownHref('https://example.com'), true);
  assert.equal(isSafeExternalMarkdownHref('//example.com/path'), true);
  assert.equal(isSafeExternalMarkdownHref('javascript:alert(1)'), false);
});
