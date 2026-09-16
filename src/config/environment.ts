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
  required('JWT_SECRET');
  if (text('JWT_SECRET').length < 32)
    throw new Error('JWT_SECRET must contain at least 32 characters');
  const port = text('PORT') || '3000';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    throw new Error('PORT must be an integer between 1 and 65535');
  result.PORT = Number(port);
  if (text('CORS_ORIGIN')) {
    for (const origin of text('CORS_ORIGIN')
      .split(',')
      .map((value) => value.trim())) {
      // Validate each origin without exposing environment values in errors.
      validateOrigin(origin);
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
  }
  const awsKeys = [
    'AWS_BUCKET_NAME',
    'AWS_REGION',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
  ];
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
  if (text('CLOUD_FRONT_URL')) httpUrl('CLOUD_FRONT_URL');
  return result;
}

function validateOrigin(origin: string) {
  try {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin)
      throw new Error();
  } catch {
    throw new Error('CORS_ORIGIN must contain comma-separated HTTP(S) origins');
  }
}
