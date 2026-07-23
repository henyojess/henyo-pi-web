describe('searchSearXNG — Playwright provider', () => {
  it('is registered in the provider map', async () => {
    const { PROVIDER_MAP } = await import('../../shared/search/providers');
    expect(PROVIDER_MAP).toHaveProperty('searxng');
    expect(typeof PROVIDER_MAP.searxng).toBe('function');
  });
});