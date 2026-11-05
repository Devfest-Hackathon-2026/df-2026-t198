import { describe, expect, it } from 'vitest';
import { validateDefinition } from '../src/definition.js';

describe('definition boundary', () => {
  it.each([
    null, [], { schemaVersion: 1, script: 'throw 1' },
    { schemaVersion: 1, method: 'POST' },
    { schemaVersion: 1, host: 'https://example.test' },
  ])('rejects unsupported executable or network configuration', (value) => {
    expect(() => validateDefinition(value)).toThrow('invalid-definition');
  });
});
