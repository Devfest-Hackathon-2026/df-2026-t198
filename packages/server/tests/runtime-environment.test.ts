import { describe, expect, it } from 'vitest';
import { assertEmulatorEnvironment } from '../src/runtime/environment.js';

const local = {
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085',
  GCLOUD_PROJECT: 'demo-kadai-hisho',
};

describe('Firebase runtime environment boundary', () => {
  it.each([{}, { NODE_ENV: 'production', K_SERVICE: 'fictional-service', GOOGLE_CLOUD_PROJECT: 'fictional-project' }])(
    'preserves optional project resolution without emulator configuration', env => {
      expect(() => assertEmulatorEnvironment(env)).not.toThrow();
    },
  );

  it.each(['127.0.0.1', 'localhost', '[::1]'])('accepts a paired local demo using %s', host => {
    const env = Object.freeze({ ...local,
      FIREBASE_AUTH_EMULATOR_HOST: `${host}:1`, FIRESTORE_EMULATOR_HOST: `${host}:65535`,
      GOOGLE_CLOUD_PROJECT: 'demo-kadai-hisho',
    });
    expect(() => assertEmulatorEnvironment(env, 'demo-kadai-hisho')).not.toThrow();
  });

  it.each(['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST'] as const)(
    'rejects partial emulator configuration when %s is absent', name => {
      const env: NodeJS.ProcessEnv = { ...local };
      delete env[name];
      expect(() => assertEmulatorEnvironment(env, 'demo-kadai-hisho')).toThrow('invalid-emulator-environment');
    },
  );

  it.each(['', '127.0.0.1:0', '127.0.0.1:65536', '127.0.0.1:1.5', '127.0.0.1:NaN',
    'https://127.0.0.1:9099', '127.0.0.1:9099/path', '127.0.0.1:9099?query',
    'remote.example.invalid:9099', '127.0.0.1.example.invalid:9099', '0.0.0.0:9099'])('rejects the endpoint %j', endpoint => {
    for (const name of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST']) {
      expect(() => assertEmulatorEnvironment({ ...local, [name]: endpoint }, 'demo-kadai-hisho'))
        .toThrow('invalid-emulator-environment');
    }
  });

  it.each([{ NODE_ENV: 'production' }, { K_SERVICE: 'fictional-service' }, { NODE_ENV: 'development', K_SERVICE: '' }])(
    'rejects emulator credentials in a deployed process', env => {
      expect(() => assertEmulatorEnvironment({ ...local, ...env }, 'demo-kadai-hisho')).toThrow('invalid-emulator-environment');
    },
  );

  it.each([undefined, 'fictional-project', ''])('rejects a missing or non-demo project %j', project => {
    expect(() => assertEmulatorEnvironment(local, project)).toThrow('invalid-emulator-environment');
  });

  it.each([{ GCLOUD_PROJECT: 'demo-other' }, { GOOGLE_CLOUD_PROJECT: 'fictional-project' }, { GOOGLE_CLOUD_PROJECT: '' }])(
    'rejects project identities that disagree with the app', env => {
      expect(() => assertEmulatorEnvironment({ ...local, ...env }, 'demo-kadai-hisho')).toThrow('invalid-emulator-environment');
    },
  );
});
