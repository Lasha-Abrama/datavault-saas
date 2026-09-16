import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../src/config/configure-app';
import { AppModule } from '../src/app.module';
import { Role } from '../src/enums/roles.enum';

describe('multi-tenant HTTP boundary (e2e)', () => {
  let app: INestApplication<App>;
  let memberToken: string;
  let ownerToken: string;
  const companyId = new Types.ObjectId();
  const memberId = new Types.ObjectId();
  const ownerId = new Types.ObjectId();
  const otherUserId = new Types.ObjectId();
  const tenantlessUserId = new Types.ObjectId();

  beforeAll(async () => {
    const users = new Map([
      [
        memberId.toString(),
        { _id: memberId, companyId, role: Role.COMPANY_MEMBER },
      ],
      [
        ownerId.toString(),
        { _id: ownerId, companyId, role: Role.COMPANY_OWNER },
      ],
      [
        tenantlessUserId.toString(),
        { _id: tenantlessUserId, role: Role.COMPANY_MEMBER },
      ],
    ]);
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getConnectionToken())
      .useValue({ close: jest.fn(), transaction: jest.fn() })
      .overrideProvider(getModelToken('user'))
      .useValue({
        findById: jest.fn((id: string) =>
          Promise.resolve(users.get(id) ?? null),
        ),
        findOne: jest.fn().mockResolvedValue(null),
      })
      .overrideProvider(getModelToken('company'))
      .useValue({
        findById: jest.fn().mockResolvedValue({ _id: companyId, name: 'Acme' }),
      })
      .compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    const jwt = app.get(JwtService);
    memberToken = jwt.sign({ id: memberId.toString() });
    ownerToken = jwt.sign({ id: ownerId.toString() });
    await app.init();
  });

  afterAll(() => app?.close());

  it('requires a company name during sign-up', () =>
    request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({
        email: 'person@example.com',
        password: 'password',
        fullName: 'Person',
      })
      .expect(400));

  it('rejects client-selected roles during sign-up', () =>
    request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({
        email: 'person@example.com',
        password: 'password',
        fullName: 'Person',
        companyName: 'Acme',
        role: Role.COMPANY_OWNER,
      })
      .expect(400));

  it('rejects a token for a deleted or unknown user', () => {
    const token = app
      .get(JwtService)
      .sign({ id: new Types.ObjectId().toString() });
    return request(app.getHttpServer())
      .get('/auth/current-user')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('rejects a user record without a company relationship', () => {
    const token = app.get(JwtService).sign({ id: tenantlessUserId.toString() });
    return request(app.getHttpServer())
      .get('/auth/current-user')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('denies a member access to the company user list', () =>
    request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(403));

  it('denies a member from creating users', () =>
    request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({
        email: 'new@example.com',
        password: 'password',
        fullName: 'New User',
      })
      .expect(403));

  it('rejects an owner attempt to select a new user role', () =>
    request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        email: 'new@example.com',
        password: 'password',
        fullName: 'New User',
        role: Role.COMPANY_OWNER,
      })
      .expect(400));

  it('does not reveal a user outside the owner company', () =>
    request(app.getHttpServer())
      .get(`/users/${otherUserId.toString()}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404));

  it('rejects an invalid MongoDB id before querying a tenant user', () =>
    request(app.getHttpServer())
      .get('/users/invalid')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(400));

  it('returns only the authenticated user company', () =>
    request(app.getHttpServer())
      .get('/companies/current')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200)
      .expect(({ body }: { body: { name: string } }) => {
        expect(body.name).toBe('Acme');
      }));

  it('allows only the company owner to update the company', () =>
    request(app.getHttpServer())
      .patch('/companies/current')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ name: 'Renamed' })
      .expect(403));

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
