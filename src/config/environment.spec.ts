import { validateEnvironment } from './environment';

const valid = {
  MONGO_URI: 'mongodb://localhost:27017/datavault',
  JWT_SECRET: 'a-secure-test-secret-with-32-characters',
  ACCOUNT_ACTIVATION_URL: 'https://client.test/auth/activate',
  EMPLOYEE_INVITATION_URL: 'https://client.test/invitations/accept',
  SMTP_HOST: 'smtp.example.test',
  SMTP_FROM: 'no-reply@example.test',
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
    [{ ...valid, SMTP_HOST: '' }, 'SMTP_HOST'],
    [{ ...valid, SMTP_FROM: 'invalid' }, 'SMTP_FROM'],
    [{ ...valid, SMTP_PORT: '0' }, 'SMTP_PORT'],
    [{ ...valid, SMTP_SECURE: 'yes' }, 'SMTP_SECURE'],
    [{ ...valid, SMTP_USER: 'user' }, 'SMTP_PASSWORD'],
    [
      { ...valid, ACCOUNT_ACTIVATION_URL: 'http://client.test' },
      'ACCOUNT_ACTIVATION_URL',
    ],
    [
      { ...valid, EMPLOYEE_INVITATION_URL: 'http://client.test' },
      'EMPLOYEE_INVITATION_URL',
    ],
  ])('rejects an invalid configuration', (config, key) => {
    expect(() => validateEnvironment(config)).toThrow(key);
  });

  it('defaults to required STARTTLS and permits authenticated implicit TLS', () => {
    expect(validateEnvironment(valid)).toMatchObject({
      SMTP_PORT: 587,
      SMTP_SECURE: false,
      SMTP_REQUIRE_TLS: true,
    });
    expect(
      validateEnvironment({
        ...valid,
        SMTP_SECURE: 'true',
        SMTP_USER: 'user',
        SMTP_PASSWORD: 'password',
      }),
    ).toMatchObject({ SMTP_PORT: 465, SMTP_SECURE: true });
  });
});
