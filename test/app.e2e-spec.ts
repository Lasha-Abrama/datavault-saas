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
import { PlanCode } from '../src/plans/plan.constants';

describe('multi-tenant HTTP boundary (e2e)', () => {
  let app: INestApplication<App>;
  let memberToken: string;
  let ownerToken: string;
  let otherOwnerToken: string;
  let unsubscribedOwnerToken: string;
  const companyId = new Types.ObjectId();
  const otherCompanyId = new Types.ObjectId();
  const unsubscribedCompanyId = new Types.ObjectId();
  const memberId = new Types.ObjectId();
  const ownerId = new Types.ObjectId();
  const otherUserId = new Types.ObjectId();
  const tenantlessUserId = new Types.ObjectId();
  const otherOwnerId = new Types.ObjectId();
  const unsubscribedOwnerId = new Types.ObjectId();

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
      [
        otherOwnerId.toString(),
        {
          _id: otherOwnerId,
          companyId: otherCompanyId,
          role: Role.COMPANY_OWNER,
        },
      ],
      [
        unsubscribedOwnerId.toString(),
        {
          _id: unsubscribedOwnerId,
          companyId: unsubscribedCompanyId,
          role: Role.COMPANY_OWNER,
        },
      ],
    ]);
    const activatedAt = new Date('2026-01-15T12:00:00.000Z');
    const subscriptions = new Map<string, PlanCode>([
      [companyId.toString(), PlanCode.FREE],
      [otherCompanyId.toString(), PlanCode.BASIC],
    ]);
    const subscriptionModel = {
      create: jest.fn(),
      findOne: jest.fn((filter: { companyId: string | Types.ObjectId }) => {
        const id = filter.companyId.toString();
        const planCode = subscriptions.get(id);
        return Promise.resolve(
          planCode
            ? {
                _id: new Types.ObjectId(),
                companyId: new Types.ObjectId(id),
                planCode,
                activatedAt,
                planChangedAt: activatedAt,
              }
            : null,
        );
      }),
      findOneAndUpdate: jest.fn(
        (
          filter: { companyId: string | Types.ObjectId },
          update: { $set?: { planCode: PlanCode } },
        ) => {
          const id = filter.companyId.toString();
          const current = subscriptions.get(id);
          if (!current) return Promise.resolve(null);
          if (update.$set) subscriptions.set(id, update.$set.planCode);
          return Promise.resolve({
            _id: new Types.ObjectId(),
            companyId: new Types.ObjectId(id),
            planCode: update.$set?.planCode ?? current,
            activatedAt,
            planChangedAt: activatedAt,
          });
        },
      ),
    };
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getConnectionToken())
      .useValue({
        close: jest.fn(),
        transaction: jest.fn((work: (session: object) => unknown) => work({})),
      })
      .overrideProvider(getModelToken('user'))
      .useValue({
        findById: jest.fn((id: string) =>
          Promise.resolve(users.get(id) ?? null),
        ),
        findOne: jest.fn().mockResolvedValue(null),
        countDocuments: jest.fn().mockResolvedValue(1),
      })
      .overrideProvider(getModelToken('company'))
      .useValue({
        findById: jest.fn().mockResolvedValue({ _id: companyId, name: 'Acme' }),
      })
      .overrideProvider(getModelToken('plan'))
      .useValue({ bulkWrite: jest.fn().mockResolvedValue(undefined) })
      .overrideProvider(getModelToken('subscription'))
      .useValue(subscriptionModel)
      .overrideProvider(getModelToken('subscriptionPeriod'))
      .useValue({
        findOne: jest.fn().mockResolvedValue(null),
        findOneAndUpdate: jest.fn(),
      })
      .compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    const jwt = app.get(JwtService);
    memberToken = jwt.sign({ id: memberId.toString() });
    ownerToken = jwt.sign({ id: ownerId.toString() });
    otherOwnerToken = jwt.sign({ id: otherOwnerId.toString() });
    unsubscribedOwnerToken = jwt.sign({ id: unsubscribedOwnerId.toString() });
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

  it('publishes the exact public plan catalog', () =>
    request(app.getHttpServer())
      .get('/plans')
      .expect(200)
      .expect(
        ({
          body,
        }: {
          body: { code: string; maxEmployees: number | null }[];
        }) => {
          expect(body).toHaveLength(3);
          expect(body).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                code: PlanCode.FREE,
                includedFilesPerMonth: 10,
                maxEmployees: 0,
                basePriceCents: 0,
              }),
              expect.objectContaining({
                code: PlanCode.BASIC,
                includedFilesPerMonth: 100,
                maxEmployees: 10,
                employeePriceCents: 500,
              }),
              expect.objectContaining({
                code: PlanCode.PREMIUM,
                includedFilesPerMonth: 1000,
                maxEmployees: null,
                basePriceCents: 30000,
                extraFilePriceCents: 50,
              }),
            ]),
          );
        },
      ));

  it('returns the authenticated company subscription to members', () =>
    request(app.getHttpServer())
      .get('/subscriptions/current')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200)
      .expect(
        ({ body }: { body: { companyId: string; plan: { code: string } } }) => {
          expect(body.companyId).toBe(companyId.toString());
          expect(body.plan.code).toBe(PlanCode.FREE);
        },
      ));

  it('isolates subscription reads by the authenticated company', () =>
    request(app.getHttpServer())
      .get('/subscriptions/current')
      .set('Authorization', `Bearer ${otherOwnerToken}`)
      .expect(200)
      .expect(
        ({ body }: { body: { companyId: string; plan: { code: string } } }) => {
          expect(body.companyId).toBe(otherCompanyId.toString());
          expect(body.plan.code).toBe(PlanCode.BASIC);
        },
      ));

  it('fails closed for a company without a subscription', () =>
    request(app.getHttpServer())
      .get('/subscriptions/current')
      .set('Authorization', `Bearer ${unsubscribedOwnerToken}`)
      .expect(404));

  it('denies members from changing the company plan', () =>
    request(app.getHttpServer())
      .patch('/subscriptions/current')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ planCode: PlanCode.BASIC })
      .expect(403));

  it('validates plan changes and rejects tenant selectors', async () => {
    await request(app.getHttpServer())
      .patch('/subscriptions/current')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ planCode: 'enterprise' })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/subscriptions/current')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ planCode: PlanCode.BASIC, companyId: otherCompanyId.toString() })
      .expect(400);
  });

  it('allows an owner to upgrade and downgrade without changing the anchor', async () => {
    const upgraded = await request(app.getHttpServer())
      .patch('/subscriptions/current')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ planCode: PlanCode.PREMIUM })
      .expect(200);
    const upgradedBody = upgraded.body as unknown as {
      plan: { code: PlanCode };
      activatedAt: string;
    };
    expect(upgradedBody.plan.code).toBe(PlanCode.PREMIUM);
    expect(upgradedBody.activatedAt).toBe('2026-01-15T12:00:00.000Z');

    const downgraded = await request(app.getHttpServer())
      .patch('/subscriptions/current')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ planCode: PlanCode.BASIC })
      .expect(200);
    const downgradedBody = downgraded.body as unknown as {
      plan: { code: PlanCode };
      activatedAt: string;
    };
    expect(downgradedBody.plan.code).toBe(PlanCode.BASIC);
    expect(downgradedBody.activatedAt).toBe('2026-01-15T12:00:00.000Z');
  });
});
