import { describe, expect, it } from 'vitest';
import { isDocumentVisible, POLL_INTERVAL_MS } from './polling';

describe('polling', () => {
  it('polls every 30 seconds, not every few seconds', () => {
    expect(POLL_INTERVAL_MS).toBe(30_000);
  });

  it('treats a visible document as pollable', () => {
    expect(isDocumentVisible()).toBe(true);
  });
});
