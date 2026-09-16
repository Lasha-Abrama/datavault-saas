import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../src/config/configure-app';
import { AppModule } from '../src/app.module';
import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import { Role } from '../src/enums/roles.enum';

describe('application HTTP boundary (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  const userId = new Types.ObjectId();

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getConnectionToken())
      .useValue({ close: jest.fn() })
      .overrideProvider(getModelToken('user'))
      .useValue({
        findById: jest
          .fn()
          .mockResolvedValue({ _id: userId, role: Role.STUDENT }),
      })
      .compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    token = app
      .get(JwtService)
      .sign({ id: userId.toString(), role: Role.STUDENT });
    await app.init();
  });

  afterAll(() => app?.close());

  it('rejects unknown sign-up fields', () =>
    request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({
        email: 'person@example.com',
        password: 'password',
        fullName: 'Person',
        role: 'admin',
      })
      .expect(400));

  it('protects current-user without a bearer token', () =>
    request(app.getHttpServer()).get('/auth/current-user').expect(401));

  it('denies a non-admin access to the user list', () =>
    request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${token}`)
      .expect(403));

  it('denies access to another user profile', () =>
    request(app.getHttpServer())
      .get(`/users/${new Types.ObjectId().toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403));

  it('rejects an invalid MongoDB id before reaching the database', () =>
    request(app.getHttpServer())
      .get('/users/invalid')
      .set('Authorization', `Bearer ${token}`)
      .expect(400));

  it('allows each comma-separated CORS origin', () =>
    request(app.getHttpServer())
      .options('/auth/sign-in')
      .set('Origin', 'https://second.example.test')
      .set('Access-Control-Request-Method', 'POST')
      .expect('Access-Control-Allow-Origin', 'https://second.example.test')
      .expect(204));

  it('reports disabled Google OAuth clearly', () =>
    request(app.getHttpServer()).get('/auth/google').expect(503));
});
