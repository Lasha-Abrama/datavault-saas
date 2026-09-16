process.env.MONGO_URI = 'mongodb://localhost:27017/datavault-test';
process.env.JWT_SECRET = 'a-secure-test-secret-with-32-characters';
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;
delete process.env.GOOGLE_CALLBACK_URL;
delete process.env.FRONT_URI;
process.env.CORS_ORIGIN =
  'https://client.example.test,https://second.example.test';
