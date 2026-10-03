import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFieldUpdateId } from './fieldUpdateId';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('field report IDs', () => {
  it('uses UTC year and the full secure UUID without any report count', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2027-01-01T00:00:00Z'));
    const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue('ac5e2a8f-6368-43e2-b493-47698bc876ef');
    expect(createFieldUpdateId()).toBe('UPD-2027-AC5E2A8F-6368-43E2-B493-47698BC876EF');
    expect(uuid).toHaveBeenCalledOnce();
  });
  it('generates distinct IDs for independent submitters without reading reports', () => {
    const ids = Array.from({ length: 1000 }, createFieldUpdateId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^UPD-\d{4}-[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
  });
});
