import { describe, expect, it } from 'vitest';
import { templates } from './templates';

const EXPECTED_IDS = [
  'card-1', 'card-2', 'card-3', 'card-4', 'card-5', 'card-6',
  'card-8', 'card-9', 'card-10', 'card-11', 'card-15',
];

describe('templates', () => {
  it('has exactly the 11 approved templates, no duplicates', () => {
    expect(templates).toHaveLength(11);
    const ids = templates.map((template) => template.id);
    expect(new Set(ids).size).toBe(11);
    expect(ids.sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it('every template has a non-empty image reference', () => {
    for (const template of templates) {
      expect(template.image.length).toBeGreaterThan(0);
    }
  });
});
