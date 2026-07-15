import { isCloudflareChallenge, isProtectedOrJsHeavy, isDefuddleFailure } from '../shared/fetch/detection';

describe('isCloudflareChallenge', () => {
  it('detects Cloudflare checking browser', () => {
    expect(isCloudflareChallenge('Checking your browser before accessing the site.')).toBe(true);
  });

  it('detects DDoS protection by Cloudflare', () => {
    expect(isCloudflareChallenge('DDoS protection by Cloudflare')).toBe(true);
  });

  it('detects __cf_chl_ markers', () => {
    expect(isCloudflareChallenge('Some __cf_chl_jschl_tk__=abc123')).toBe(true);
  });

  it('returns false for non-Cloudflare content', () => {
    expect(isCloudflareChallenge('Just regular HTML content')).toBe(false);
  });
});

describe('isProtectedOrJsHeavy', () => {
  it('detects Cloudflare challenge', () => {
    expect(isProtectedOrJsHeavy('<html><body>Cloudflare Challenge page</body></html>')).toBe(true);
  });

  it('detects CAPTCHA', () => {
    expect(isProtectedOrJsHeavy('<html><body>captcha detected</body></html>')).toBe(true);
  });

  it('detects SPA with __nuxt and few scripts', () => {
    expect(isProtectedOrJsHeavy('<html><body></body></noscript><div id="__nuxt"></div></html>')).toBe(true);
  });

  it('detects JS-required message', () => {
    expect(isProtectedOrJsHeavy('<html><body>This site requires javascript</body></html>')).toBe(true);
  });

  it('returns false for normal page with lots of text', () => {
    // Page with many scripts but enough text content — should NOT trigger hasFewTextButManyScripts
    const longText = 'A'.repeat(100);
    const html = `<html><body><script src="a.js"></script><script src="b.js"></script><script src="c.js"></script><script src="d.js"></script><script src="e.js"></script><script src="f.js"></script><p>${longText}</p></body></html>`;
    expect(isProtectedOrJsHeavy(html)).toBe(false);
  });

  it('returns false for page with few scripts and little text', () => {
    // Page with few scripts but very little text — should NOT trigger hasFewTextButManyScripts
    const html = '<html><body><script src="a.js"></script><script src="b.js"></script><script src="c.js"></script><p>X</p></body></html>';
    expect(isProtectedOrJsHeavy(html)).toBe(false);
  });

  it('returns false for normal HTML without protection markers', () => {
    expect(isProtectedOrJsHeavy('<html><head><title>Test</title></head><body><p>Regular content here with enough text to not be flagged as protected.</p></body></html>')).toBe(false);
  });
});

describe('isDefuddleFailure', () => {
  it('returns true when bodyText is empty', () => {
    expect(isDefuddleFailure({ bodyText: '', title: 'Test', author: '', description: '', date: '', lang: '' })).toBe(true);
  });

  it('returns true when bodyText is too short', () => {
    expect(isDefuddleFailure({ bodyText: 'short', title: 'Test', author: '', description: '', date: '', lang: '' })).toBe(true);
  });

  it('returns true when title is Untitled', () => {
    expect(isDefuddleFailure({ bodyText: 'Some content here that is long enough to pass the quality threshold for extraction and be considered valid by the pipeline.', title: 'Untitled', author: '', description: '', date: '', lang: '' })).toBe(true);
  });

  it('returns true when title is Untitled Document', () => {
    expect(isDefuddleFailure({ bodyText: 'Some content here that is long enough to pass the quality threshold for extraction and be considered valid by the pipeline.', title: 'Untitled Document', author: '', description: '', date: '', lang: '' })).toBe(true);
  });

  it('returns true when title is a URL', () => {
    expect(isDefuddleFailure({ bodyText: 'Some content here that is long enough to pass the quality threshold for extraction and be considered valid by the pipeline.', title: 'https://example.com', author: '', description: '', date: '', lang: '' })).toBe(true);
  });

  it('returns false for good content', () => {
    expect(isDefuddleFailure({ bodyText: 'This is good content with enough text to pass the quality threshold for extraction and be considered a valid result by the pipeline and the overall system.', title: 'Good Title', author: '', description: '', date: '', lang: '' })).toBe(false);
  });
});