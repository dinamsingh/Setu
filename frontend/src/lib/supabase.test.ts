import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('Supabase local configuration', () => {
  it('treats a missing or whitespace publishable key as unconfigured', async () => {
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '   ');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const config = await import('./supabase');

    expect(config.isSupabaseConfigured).toBe(false);
    expect(config.SUPABASE_CONFIGURATION_ERROR).toContain('VITE_SUPABASE_PUBLISHABLE_KEY');
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('Authentication is disabled'));
  });

  it('accepts a configured publishable key without enabling any privileged client capability', async () => {
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test_key');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const config = await import('./supabase');

    expect(config.isSupabaseConfigured).toBe(true);
    expect(warning).not.toHaveBeenCalled();
  });
});
