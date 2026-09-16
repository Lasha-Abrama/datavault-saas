# NestJS Starter

A comprehensive NestJS starter template with built-in authentication (JWT + Google OAuth), MongoDB integration, AWS S3 file uploads, and basic user management.

## Features

- **NestJS Framework** - Progressive Node.js framework for building server-side applications
- **MongoDB Integration** with Mongoose
- **Authentication**
  - JWT Authentication
  - Google OAuth 2.0
- **File Storage** with AWS S3
- **User Management** - CRUD operations
- **Environment Configuration**
- **TypeScript** - Full type safety throughout the application

## Prerequisites

- Node.js (v14 or newer)
- MongoDB (local instance or MongoDB Atlas)
- AWS Account (for S3 bucket access)
- Google Developer Console project (for OAuth)

## Installation

1. Clone the repository
```bash
git clone https://github.com/Datodia/nestjs-starter.git
cd nestjs-starter
```

2. Install dependencies
```bash
npm install
```

3. Set up environment variables by creating a `.env` file in the root directory:
```
MONGO_URI=
FRONT_URI=
PORT=
JWT_SECRET=

AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_BUCKET_NAME=
AWS_REGION=

CLOUD_FRONT_URI=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=


CORS_ORIGIN=
```

## Running the Application

### Development
```bash
npm run start:dev
```

### Production
```bash
npm run build
npm run start:prod
```

## API Endpoints

### Authentication
- `POST /auth/register` - Register a new user
- `POST /auth/login` - Login with email and password
- `GET /auth/google` - Initiate Google OAuth login
- `GET /auth/google/callback` - Google OAuth callback
- `GET /auth/current-user` - 🔒 Get current user profile (requires authentication)

### Users
- `GET /users` - 🔒 Get all users (admin only)
- `GET /users/:id` - 🔒 Get user by ID
- `PATCH /users/:id` - 🔒 Update user
- `DELETE /users/:id` - 🔒 Delete user


## Authentication Flow

### JWT Authentication
1. User registers or logs in with email/password
2. Server validates credentials and returns a JWT token
3. Subsequent requests include this token in the Authorization header

### Google OAuth
1. User initiates authentication via `/auth/google` endpoint
2. After successful Google authentication, user is redirected back with a code
3. Server exchanges this code for user information
4. User is either logged in or a new account is created

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [NestJS](https://nestjs.com/)
- [Mongoose](https://mongoosejs.com/)
- [Passport.js](http://www.passportjs.org/)
- [AWS SDK](https://aws.amazon.com/sdk-for-javascript/)
