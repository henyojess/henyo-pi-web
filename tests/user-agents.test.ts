import { pickRandom, delay, USER_AGENTS, ACCEPT_LANGUAGES } from '../shared/user-agents';

describe('pickRandom', () => {
  it('returns an element from the array', () => {
    const arr = [1, 2, 3, 4, 5];
    for (let i = 0; i < 50; i++) {
      const result = pickRandom(arr);
      expect(arr).toContain(result);
    }
  });

  it('works with string arrays', () => {
    const result = pickRandom(USER_AGENTS);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(10);
  });
});

describe('delay', () => {
  it('resolves after the specified time', async () => {
    const start = Date.now();
    await delay(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(200);
  });

  it('resolves immediately for 0ms', async () => {
    const start = Date.now();
    await delay(0);
    expect(Date.now() - start).toBeLessThan(100);
  });
});

describe('USER_AGENTS', () => {
  it('has multiple user agents', () => {
    expect(USER_AGENTS.length).toBeGreaterThanOrEqual(2);
  });

  it('all user agents are non-empty strings', () => {
    for (const ua of USER_AGENTS) {
      expect(typeof ua).toBe('string');
      expect(ua.length).toBeGreaterThan(10);
    }
  });

  it('includes Chrome user agent', () => {
    expect(USER_AGENTS.some(ua => ua.includes('Chrome'))).toBe(true);
  });

  it('includes Firefox user agent', () => {
    expect(USER_AGENTS.some(ua => ua.includes('Firefox'))).toBe(true);
  });

  it('includes mobile user agent', () => {
    expect(USER_AGENTS.some(ua => ua.includes('Mobile'))).toBe(true);
  });
});

describe('ACCEPT_LANGUAGES', () => {
  it('has multiple accept-language values', () => {
    expect(ACCEPT_LANGUAGES.length).toBeGreaterThanOrEqual(2);
  });

  it('all values contain en', () => {
    for (const val of ACCEPT_LANGUAGES) {
      expect(val).toContain('en');
    }
  });
});