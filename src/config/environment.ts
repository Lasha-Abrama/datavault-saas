import { isEmail } from 'class-validator';

export function validateEnvironment(config: Record<string, unknown>) {
  const result = { ...config };
  const text = (key: string) =>
    typeof config[key] === 'string' ? config[key] : '';
  const required = (key: string) => {
    if (!text(key).trim()) throw new Error(`${key} is required`);
  };
  const httpUrl = (key: string, originOnly = false) => {
    try {
      const url = new URL(text(key));
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        (originOnly && url.origin !== text(key))
      )
        throw new Error();
    } catch {
      throw new Error(
        `${key} must be a valid HTTP(S) ${originOnly ? 'origin' : 'URL'}`,
      );
    }
  };
  required('MONGO_URI');
  if (!/^mongodb(?:\+srv)?:\/\//.test(text('MONGO_URI')))
    throw new Error('MONGO_URI must be a MongoDB connection URI');
  const nodeEnv = text('NODE_ENV') || 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv))
    throw new Error('NODE_ENV must be development, test, or production');
  result.NODE_ENV = nodeEnv;
  result.MONGO_SERVER_SELECTION_TIMEOUT_MS = integer(
    'MONGO_SERVER_SELECTION_TIMEOUT_MS',
    10_000,
    1_000,
    120_000,
  );
  result.MONGO_MAX_POOL_SIZE = integer('MONGO_MAX_POOL_SIZE', 20, 1, 200);
  result.MONGO_RETRY_ATTEMPTS = integer('MONGO_RETRY_ATTEMPTS', 5, 1, 20);
  result.MONGO_RETRY_DELAY_MS = integer(
    'MONGO_RETRY_DELAY_MS',
    3_000,
    100,
    30_000,
  );
  required('JWT_SECRET');
  if (text('JWT_SECRET').length < 32)
    throw new Error('JWT_SECRET must contain at least 32 characters');
  const port = text('PORT') || '3000';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    throw new Error('PORT must be an integer between 1 and 65535');
  result.PORT = Number(port);
  result.TRUST_PROXY_HOPS = integer('TRUST_PROXY_HOPS', 0, 0, 10);
  const fileMaxSizeBytes = text('FILE_MAX_SIZE_BYTES') || '10485760';
  if (
    !/^\d+$/.test(fileMaxSizeBytes) ||
    Number(fileMaxSizeBytes) < 1 ||
    Number(fileMaxSizeBytes) > 104857600
  )
    throw new Error(
      'FILE_MAX_SIZE_BYTES must be an integer between 1 and 104857600',
    );
  result.FILE_MAX_SIZE_BYTES = Number(fileMaxSizeBytes);
  required('ACCOUNT_ACTIVATION_URL');
  httpUrl('ACCOUNT_ACTIVATION_URL');
  requireHttpsOutsideLocalhost('ACCOUNT_ACTIVATION_URL');
  required('EMPLOYEE_INVITATION_URL');
  httpUrl('EMPLOYEE_INVITATION_URL');
  requireHttpsOutsideLocalhost('EMPLOYEE_INVITATION_URL');
  required('SMTP_HOST');
  if (!/^[A-Za-z0-9.:[\]_-]+$/.test(text('SMTP_HOST')))
    throw new Error('SMTP_HOST must be a valid hostname or IP address');
  required('SMTP_FROM');
  if (!isEmail(text('SMTP_FROM')))
    throw new Error('SMTP_FROM must be a valid email address');
  const smtpSecure = boolean('SMTP_SECURE', false);
  const smtpRequireTls = boolean('SMTP_REQUIRE_TLS', true);
  const smtpPort = text('SMTP_PORT') || (smtpSecure ? '465' : '587');
  if (
    !/^\d+$/.test(smtpPort) ||
    Number(smtpPort) < 1 ||
    Number(smtpPort) > 65535
  )
    throw new Error('SMTP_PORT must be an integer between 1 and 65535');
  result.SMTP_PORT = Number(smtpPort);
  result.SMTP_SECURE = smtpSecure;
  result.SMTP_REQUIRE_TLS = smtpRequireTls;
  if (text('SMTP_USER') || text('SMTP_PASSWORD')) {
    required('SMTP_USER');
    required('SMTP_PASSWORD');
  }
  if (text('CORS_ORIGIN')) {
    for (const origin of text('CORS_ORIGIN')
      .split(',')
      .map((value) => value.trim())) {
      // Validate each origin without exposing environment values in errors.
      const url = validateOrigin(origin);
      if (url.protocol !== 'https:' && !isLocalhost(url.hostname))
        throw new Error('CORS_ORIGIN must use HTTPS outside localhost');
    }
  }
  const googleKeys = [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_CALLBACK_URL',
    'FRONT_URI',
  ];
  if (googleKeys.some((key) => text(key))) {
    googleKeys.forEach(required);
    httpUrl('GOOGLE_CALLBACK_URL');
    httpUrl('FRONT_URI', true);
    requireHttpsOutsideLocalhost('GOOGLE_CALLBACK_URL');
    requireHttpsOutsideLocalhost('FRONT_URI');
  }
  const awsKeys = [
    'AWS_BUCKET_NAME',
    'AWS_REGION',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
  ];
  const stripeEnabled = boolean('STRIPE_ENABLED', false);
  result.STRIPE_ENABLED = stripeEnabled;
  result.STRIPE_SYNC_INTERVAL_MS = integer(
    'STRIPE_SYNC_INTERVAL_MS',
    30000,
    10000,
    300000,
  );
  if (stripeEnabled) {
    const stripeKeys = [
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'STRIPE_BASIC_PRICE_ID',
      'STRIPE_PREMIUM_PRICE_ID',
      'STRIPE_OVERAGE_PRICE_ID',
      'STRIPE_OVERAGE_METER_ID',
      'STRIPE_OVERAGE_EVENT_NAME',
      'STRIPE_PORTAL_CONFIGURATION_ID',
      'STRIPE_CHECKOUT_SUCCESS_URL',
      'STRIPE_CHECKOUT_CANCEL_URL',
      'STRIPE_PORTAL_RETURN_URL',
    ];
    stripeKeys.forEach(required);
    if (!/^sk_test_[A-Za-z0-9]+$/.test(text('STRIPE_SECRET_KEY')))
      throw new Error('STRIPE_SECRET_KEY must be a Test Mode secret key');
    if (!/^whsec_[A-Za-z0-9]+$/.test(text('STRIPE_WEBHOOK_SECRET')))
      throw new Error('STRIPE_WEBHOOK_SECRET must be a webhook signing secret');
    for (const key of [
      'STRIPE_BASIC_PRICE_ID',
      'STRIPE_PREMIUM_PRICE_ID',
      'STRIPE_OVERAGE_PRICE_ID',
    ])
      if (!/^price_[A-Za-z0-9]+$/.test(text(key)))
        throw new Error(`${key} must be a Stripe Price ID`);
    if (
      new Set(
        [
          'STRIPE_BASIC_PRICE_ID',
          'STRIPE_PREMIUM_PRICE_ID',
          'STRIPE_OVERAGE_PRICE_ID',
        ].map(text),
      ).size !== 3
    )
      throw new Error('Stripe plan Price IDs must be distinct');
    if (!/^mtr_(?:test_)?[A-Za-z0-9]+$/.test(text('STRIPE_OVERAGE_METER_ID')))
      throw new Error('STRIPE_OVERAGE_METER_ID must be a Stripe meter ID');
    if (!/^[A-Za-z0-9_]+$/.test(text('STRIPE_OVERAGE_EVENT_NAME')))
      throw new Error(
        'STRIPE_OVERAGE_EVENT_NAME must contain only letters, digits and underscores',
      );
    if (!/^bpc_[A-Za-z0-9]+$/.test(text('STRIPE_PORTAL_CONFIGURATION_ID')))
      throw new Error(
        'STRIPE_PORTAL_CONFIGURATION_ID must be a Stripe Portal configuration ID',
      );
    for (const key of [
      'STRIPE_CHECKOUT_SUCCESS_URL',
      'STRIPE_CHECKOUT_CANCEL_URL',
      'STRIPE_PORTAL_RETURN_URL',
    ]) {
      httpUrl(key);
      requireHttpsOutsideLocalhost(key);
      const url = new URL(text(key));
      if (nodeEnv === 'production' && url.protocol !== 'https:')
        throw new Error(`${key} must use HTTPS in production`);
    }
  }
  if (awsKeys.some((key) => text(key))) {
    required('AWS_BUCKET_NAME');
    required('AWS_REGION');
    if (text('AWS_ACCESS_KEY_ID') || text('AWS_SECRET_ACCESS_KEY')) {
      required('AWS_ACCESS_KEY_ID');
      required('AWS_SECRET_ACCESS_KEY');
    }
    if (text('AWS_SESSION_TOKEN')) {
      required('AWS_ACCESS_KEY_ID');
      required('AWS_SECRET_ACCESS_KEY');
    }
  }
  return result;

  function boolean(key: string, defaultValue: boolean) {
    const value = text(key).trim().toLowerCase();
    if (!value) return defaultValue;
    if (!['true', 'false'].includes(value))
      throw new Error(`${key} must be true or false`);
    return value === 'true';
  }

  function integer(
    key: string,
    defaultValue: number,
    minimum: number,
    maximum: number,
  ) {
    const value = text(key) || String(defaultValue);
    if (
      !/^\d+$/.test(value) ||
      Number(value) < minimum ||
      Number(value) > maximum
    )
      throw new Error(
        `${key} must be an integer between ${minimum} and ${maximum}`,
      );
    return Number(value);
  }

  function requireHttpsOutsideLocalhost(key: string) {
    const url = new URL(text(key));
    if (url.protocol !== 'https:' && !isLocalhost(url.hostname))
      throw new Error(`${key} must use HTTPS outside localhost`);
  }
}

function validateOrigin(origin: string) {
  try {
    const url = new URL(origin);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== origin ||
      url.username ||
      url.password
    )
      throw new Error();
    return url;
  } catch {
    throw new Error('CORS_ORIGIN must contain comma-separated HTTP(S) origins');
  }
}

function isLocalhost(hostname: string) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
}
