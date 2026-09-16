import { validateEnvironment } from './environment';

const valid = {
  MONGO_URI: 'mongodb://localhost:27017/datavault',
  JWT_SECRET: 'a-secure-test-secret-with-32-characters',
};

describe('validateEnvironment', () => {
  it('applies defaults and accepts disabled optional integrations', () => {
    expect(validateEnvironment(valid)).toMatchObject({ ...valid, PORT: 3000 });
  });

  it.each([
    [{ ...valid, JWT_SECRET: 'short' }, 'JWT_SECRET'],
    [{ ...valid, CORS_ORIGIN: 'https://valid.test/path' }, 'CORS_ORIGIN'],
    [{ ...valid, GOOGLE_CLIENT_ID: 'id' }, 'GOOGLE_CLIENT_SECRET'],
    [{ ...valid, AWS_ACCESS_KEY_ID: 'id' }, 'AWS_BUCKET_NAME'],
  ])('rejects an invalid configuration', (config, key) => {
    expect(() => validateEnvironment(config)).toThrow(key);
  });
});
