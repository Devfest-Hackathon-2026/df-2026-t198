import { expect, it } from 'vitest';
import { missingConfig, probeConfig } from '../src/auth/config.js';

it('lists missing web settings without leaking provided values', () => {
  expect(missingConfig(probeConfig)).toEqual(['oauthClientId（Chrome拡張用）', 'firebase.apiKey', 'firebase.authDomain', 'firebase.projectId', 'firebase.appId']);
  expect(missingConfig({ ...probeConfig, oauthClientId: 'synthetic-secret' })).not.toContain('synthetic-secret');
  expect(missingConfig({ ...probeConfig, invalidJson: true })).toEqual(['config.local.json（JSONの書式）']);
});
