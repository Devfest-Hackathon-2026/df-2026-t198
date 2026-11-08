import validDefinition from '../../../lms-definitions/demo-lms/definition.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';
import { validateDefinition } from '../src/definition.js';

describe('definition boundary', () => {
  it('accepts the control definition', () => {
    expect(validateDefinition(validDefinition)).toEqual(validDefinition);
  });
  it.each([null, []])('rejects a non-object definition: %j', value => {
    expect(() => validateDefinition(value)).toThrow('invalid-definition');
  });
  it.each([
    ['script', 'throw 1'], ['method', 'POST'], ['host', 'https://example.test'],
  ])('rejects unsupported %s on an otherwise valid definition', (key, value) => {
    const definition = { ...validateDefinition(validDefinition), [key]: value };
    expect(() => validateDefinition(definition)).toThrow('invalid-definition');
  });
});
