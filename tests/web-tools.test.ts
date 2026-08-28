import { WEB_TOOL_NAMES, hideWebTools, activateWebTools, type ToolActivator } from '../shared/web-tools';

// ─── mock pi ─────────────────────────────────────────────────────────────────

function createMockPi(activeTools: string[]): {
  pi: ToolActivator;
  setActiveCalls: string[][];
} {
  const calls: string[][] = [];
  const state = { active: [...activeTools] };
  return {
    pi: {
      getActiveTools: () => state.active,
      setActiveTools: (names: string[]) => {
        calls.push([...names]);
        state.active = [...names];
      },
    },
    setActiveCalls: calls,
  };
}

describe('WEB_TOOL_NAMES', () => {
  it('lists exactly the six web tools', () => {
    expect([...WEB_TOOL_NAMES].sort()).toEqual([
      'henyo_fetch',
      'search_ddg',
      'search_github',
      'search_npm',
      'search_stackoverflow',
      'search_wikipedia',
    ]);
  });
});

describe('hideWebTools', () => {
  it('removes all six web tools and keeps other tool names', () => {
    const { pi, setActiveCalls } = createMockPi([
      'read', 'bash', 'search_ddg', 'search_wikipedia', 'search_stackoverflow',
      'search_npm', 'search_github', 'henyo_fetch', 'custom_tool',
    ]);
    hideWebTools(pi);
    expect(pi.getActiveTools()).toEqual(['read', 'bash', 'custom_tool']);
    expect(setActiveCalls).toHaveLength(1);
  });

  it('is idempotent — hiding twice equals hiding once (second call is a no-op)', () => {
    const { pi, setActiveCalls } = createMockPi(['read', 'search_ddg', 'henyo_fetch']);
    hideWebTools(pi);
    const afterFirst = pi.getActiveTools();
    hideWebTools(pi);
    expect(pi.getActiveTools()).toEqual(afterFirst);
    expect(setActiveCalls).toHaveLength(1);
  });
});

describe('activateWebTools', () => {
  it('from hidden state: adds exactly the six, preserves other names, one setActiveTools call', () => {
    const { pi, setActiveCalls } = createMockPi(['read', 'bash']);
    const result = activateWebTools(pi);
    expect(result.added).toEqual(WEB_TOOL_NAMES);
    expect(result.alreadyActive).toEqual([]);
    expect(setActiveCalls).toHaveLength(1);
    expect(pi.getActiveTools()).toEqual(['read', 'bash', ...WEB_TOOL_NAMES]);
  });

  it('all six active: added empty, zero setActiveTools calls', () => {
    const { pi, setActiveCalls } = createMockPi(['read', ...WEB_TOOL_NAMES]);
    const result = activateWebTools(pi);
    expect(result.added).toEqual([]);
    expect(result.alreadyActive).toEqual(WEB_TOOL_NAMES);
    expect(setActiveCalls).toHaveLength(0);
  });

  it('partial state: additive only, already-active web tools not duplicated', () => {
    const { pi, setActiveCalls } = createMockPi(['read', 'search_ddg']);
    const result = activateWebTools(pi);
    expect(result.added).toEqual(WEB_TOOL_NAMES.filter((n) => n !== 'search_ddg'));
    expect(result.alreadyActive).toEqual(['search_ddg']);
    expect(setActiveCalls).toHaveLength(1);
    expect(pi.getActiveTools()).toEqual(
      ['read', 'search_ddg', ...WEB_TOOL_NAMES.filter((n) => n !== 'search_ddg')],
    );
  });
});
