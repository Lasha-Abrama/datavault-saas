import { ExecutionContext, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import { Request } from 'express';
import { Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { GoogleUser } from '../src/auth/auth.types';
import { RESEND_VERIFICATION_RESPONSE } from '../src/auth/company-verification.service';
import { configureApp } from '../src/config/configure-app';
import { EmailMessage, EmailSender } from '../src/email/email-sender';
import { Role } from '../src/enums/roles.enum';
import { GoogleOauthGuard } from '../src/guards/google-oauth.guard';
import { PlanCode } from '../src/plans/plan.constants';

interface CompanyState {
  _id: Types.ObjectId;
  name: string;
  country: string;
  industry: string;
  activatedAt: Date | null;
}
interface UserState {
  _id: Types.ObjectId;
  companyId: Types.ObjectId;
  email: string;
  password: string;
  fullName?: string;
  role: Role;
  save: () => Promise<void>;
  toJSON: () => Record<string, unknown>;
}
interface VerificationState {
  companyId: Types.ObjectId;
  ownerId: Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  lastSentAt: Date;
}
interface SubscriptionState {
  companyId: Types.ObjectId;
  planCode: PlanCode;
  activatedAt: Date;
  planChangedAt: Date;
}
interface CompanyFilter {
  _id: Types.ObjectId;
  activatedAt?: null | { $ne: null };
}

const registration = {
  companyName: '  Acme  ',
  email: 'OWNER@EXAMPLE.COM ',
  password: 'password',
  country: ' ge ',
  industry: '  Financial   Services ',
};
const duplicate = (field?: string) =>
  Object.assign(new Error('Duplicate key'), {
    code: 11000,
    keyPattern: field ? { [field]: 1 } : undefined,
  });
const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

// HTTP integration uses stateful database providers and a mocked outbound sender.
// Actual replica-set transactions and index enforcement require a database integration suite.
describe('company registration and activation (e2e)', () => {
  let app: INestApplication<App>;
  const companies = new Map<string, CompanyState>();
  const users = new Map<string, UserState>();
  const verifications = new Map<string, VerificationState>();
  const subscriptions = new Map<string, SubscriptionState>();
  const sender = { send: jest.fn<Promise<void>, [EmailMessage]>() };

  function findCompany(filter: CompanyFilter) {
    const company = companies.get(filter._id.toString());
    if (!company) return null;
    if (filter.activatedAt === null && company.activatedAt !== null)
      return null;
    if (filter.activatedAt && company.activatedAt === null) return null;
    return company;
  }

  beforeEach(async () => {
    companies.clear();
    users.clear();
    verifications.clear();
    subscriptions.clear();
    sender.send.mockReset().mockResolvedValue(undefined);
    const companyModel = {
      create: jest.fn((inputs: Omit<CompanyState, '_id'>[]) => {
        const input = inputs[0];
        if (
          [...companies.values()].some(
            (company) =>
              company.name.toLowerCase() === input.name.toLowerCase(),
          )
        )
          throw duplicate('name');
        const company = { _id: new Types.ObjectId(), ...input };
        companies.set(company._id.toString(), company);
        return Promise.resolve([company]);
      }),
      findById: jest.fn((id: string) =>
        Promise.resolve(companies.get(id) ?? null),
      ),
      findOne: jest.fn((filter: CompanyFilter) =>
        Promise.resolve(findCompany(filter)),
      ),
      findOneAndUpdate: jest.fn(
        (filter: CompanyFilter, update: { $set: { activatedAt: Date } }) => {
          const company = findCompany(filter);
          if (company) company.activatedAt = update.$set.activatedAt;
          return Promise.resolve(company);
        },
      ),
    };
    const userModel = {
      create: jest.fn(
        (inputs: Omit<UserState, '_id' | 'save' | 'toJSON'>[]) => {
          const input = inputs[0];
          if ([...users.values()].some((user) => user.email === input.email))
            throw duplicate('email');
          const user: UserState = {
            ...input,
            _id: new Types.ObjectId(),
            save: jest.fn().mockResolvedValue(undefined),
            toJSON: () => ({
              _id: user._id,
              companyId: user.companyId,
              email: user.email,
              fullName: user.fullName,
              role: user.role,
            }),
          };
          users.set(user._id.toString(), user);
          return Promise.resolve([user]);
        },
      ),
      findById: jest.fn((id: string) => Promise.resolve(users.get(id) ?? null)),
      findOne: jest.fn(
        (filter: {
          email?: string;
          _id?: Types.ObjectId;
          companyId?: Types.ObjectId;
          role?: Role;
        }) => {
          const user =
            [...users.values()].find(
              (value) =>
                (filter.email === undefined || value.email === filter.email) &&
                (filter._id === undefined || value._id.equals(filter._id)) &&
                (filter.companyId === undefined ||
                  value.companyId.equals(filter.companyId)) &&
                (filter.role === undefined || value.role === filter.role),
            ) ?? null;
          const result = Promise.resolve(user);
          return Object.assign(result, { select: () => result });
        },
      ),
      countDocuments: jest.fn((filter: { companyId: string; role: Role }) =>
        Promise.resolve(
          [...users.values()].filter(
            (user) =>
              user.companyId.toString() === filter.companyId &&
              user.role === filter.role,
          ).length,
        ),
      ),
    };
    const verificationModel = {
      create: jest.fn((inputs: VerificationState[]) => {
        verifications.set(inputs[0].companyId.toString(), inputs[0]);
        return Promise.resolve(inputs);
      }),
      findOneAndDelete: jest.fn(
        (filter: { tokenHash: string; expiresAt: { $gt: Date } }) => {
          const verification = [...verifications.values()].find(
            (value) =>
              value.tokenHash === filter.tokenHash &&
              value.expiresAt > filter.expiresAt.$gt,
          );
          if (verification)
            verifications.delete(verification.companyId.toString());
          return Promise.resolve(verification ?? null);
        },
      ),
      findOneAndUpdate: jest.fn(
        (
          filter: {
            companyId: Types.ObjectId;
            $or: { lastSentAt: { $lte?: Date } }[];
          },
          update: {
            $set: Pick<
              VerificationState,
              'tokenHash' | 'expiresAt' | 'lastSentAt'
            >;
            $setOnInsert: Pick<VerificationState, 'companyId' | 'ownerId'>;
          },
        ) => {
          const id = filter.companyId.toString();
          const existing = verifications.get(id);
          if (existing && existing.lastSentAt > filter.$or[0].lastSentAt.$lte!)
            throw duplicate();
          const verification = {
            ...(existing ?? update.$setOnInsert),
            ...update.$set,
          };
          verifications.set(id, verification);
          return Promise.resolve(verification);
        },
      ),
    };
    const subscriptionModel = {
      create: jest.fn((inputs: SubscriptionState[]) => {
        subscriptions.set(inputs[0].companyId.toString(), inputs[0]);
        return Promise.resolve(inputs);
      }),
      findOne: jest.fn((filter: { companyId: string }) =>
        Promise.resolve(subscriptions.get(filter.companyId) ?? null),
      ),
    };
    const connection = {
      close: jest.fn(),
      transaction: jest.fn(
        async (work: (session: object) => Promise<unknown>) => {
          const snapshots = [
            new Map(companies),
            new Map(users),
            new Map(verifications),
            new Map(subscriptions),
          ] as const;
          try {
            return await work({});
          } catch (error) {
            companies.clear();
            snapshots[0].forEach((value, key) => companies.set(key, value));
            users.clear();
            snapshots[1].forEach((value, key) => users.set(key, value));
            verifications.clear();
            snapshots[2].forEach((value, key) => verifications.set(key, value));
            subscriptions.clear();
            snapshots[3].forEach((value, key) => subscriptions.set(key, value));
            throw error;
          }
        },
      ),
    };
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getConnectionToken())
      .useValue(connection)
      .overrideProvider(getModelToken('company'))
      .useValue(companyModel)
      .overrideProvider(getModelToken('user'))
      .useValue(userModel)
      .overrideProvider(getModelToken('companyVerification'))
      .useValue(verificationModel)
      .overrideProvider(getModelToken('subscription'))
      .useValue(subscriptionModel)
      .overrideProvider(getModelToken('subscriptionPeriod'))
      .useValue({ findOne: jest.fn().mockResolvedValue(null) })
      .overrideProvider(getModelToken('employeeInvitation'))
      .useValue({ countDocuments: jest.fn().mockResolvedValue(0) })
      .overrideProvider(getModelToken('companyFile'))
      .useValue({})
      .overrideProvider(getModelToken('plan'))
      .useValue({ bulkWrite: jest.fn() })
      .overrideProvider(EmailSender)
      .useValue(sender)
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          JWT_SECRET: 'a-secure-test-secret-with-32-characters',
          ACCOUNT_ACTIVATION_URL: 'https://client.example.test/auth/activate',
          EMPLOYEE_INVITATION_URL:
            'https://client.example.test/invitations/accept',
          FILE_MAX_SIZE_BYTES: 10485760,
          FRONT_URI: 'https://client.example.test',
        }),
      )
      .overrideGuard(GoogleOauthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context
            .switchToHttp()
            .getRequest<Request & { user: GoogleUser }>().user = {
            email: 'owner@example.com',
            fullName: 'Owner',
          };
          return true;
        },
      })
      .compile();
    app = fixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(() => app?.close());

  function lastToken() {
    const message = sender.send.mock.calls.at(-1)?.[0];
    const url = message?.text
      .split('\n')
      .find((line) => line.startsWith('https://'));
    if (!url) throw new Error('No activation email captured');
    return new URL(url).searchParams.get('token')!;
  }
  function register(overrides: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ ...registration, ...overrides });
  }
  function verify(token: string) {
    return request(app.getHttpServer())
      .post('/auth/verify-account')
      .send({ token });
  }

  it('collects only the required registration fields, normalizes data, hashes the token and provisions Free', async () => {
    const response = await register().expect(202);
    const company = [...companies.values()][0];
    const user = [...users.values()][0];
    expect(company).toMatchObject({
      name: 'Acme',
      country: 'GE',
      industry: 'Financial Services',
      activatedAt: null,
    });
    expect(company).not.toHaveProperty('email');
    expect(company).not.toHaveProperty('password');
    expect(user.email).toBe('owner@example.com');
    expect(user.password).not.toBe('password');
    expect(user.fullName).toBeUndefined();
    expect(user.companyId).toEqual(company._id);
    expect(user.role).toBe(Role.COMPANY_OWNER);
    expect(subscriptions.get(company._id.toString())?.planCode).toBe(
      PlanCode.FREE,
    );
    const token = lastToken();
    expect(verifications.get(company._id.toString())?.tokenHash).toBe(
      hash(token),
    );
    expect(JSON.stringify(response.body)).not.toContain(token);
    expect(JSON.stringify(response.body)).not.toContain(hash(token));
    expect(response.body).not.toHaveProperty('accessToken');
  });

  it.each([
    { country: undefined },
    { country: 'XX' },
    { industry: ' ' },
    { companyName: ' ' },
    { email: 'invalid' },
    { password: 'short' },
    { fullName: null },
    { activatedAt: new Date().toISOString() },
    { role: Role.COMPANY_OWNER },
  ])(
    'rejects invalid/missing registration fields and client-controlled state: %p',
    async (override) => {
      await register(override).expect(400);
      expect(companies.size).toBe(0);
      expect(sender.send).not.toHaveBeenCalled();
    },
  );

  it('blocks login and all protected tenant functionality until activation, then permits normal sign-in', async () => {
    await register().expect(202);
    const user = [...users.values()][0];
    const forgedToken = app.get(JwtService).sign({ id: user._id.toString() });
    await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email: user.email, password: 'password' })
      .expect(401);
    for (const path of [
      '/auth/current-user',
      '/companies/current',
      '/users',
      '/subscriptions/current',
      '/files',
    ]) {
      await request(app.getHttpServer())
        .get(path)
        .set('Authorization', 'Bearer ' + forgedToken)
        .expect(401);
    }
    const token = lastToken();
    await verify(token).expect(200);
    await verify(token).expect(400);
    expect(verifications.size).toBe(0);
    const login = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email: user.email, password: 'password' })
      .expect(201);
    const body = login.body as unknown as { accessToken: string };
    await request(app.getHttpServer())
      .get('/companies/current')
      .set('Authorization', 'Bearer ' + body.accessToken)
      .expect(200);
    await request(app.getHttpServer())
      .get('/subscriptions/current')
      .set('Authorization', 'Bearer ' + body.accessToken)
      .expect(200)
      .expect(({ body }: { body: { plan: { code: PlanCode } } }) =>
        expect(body.plan.code).toBe(PlanCode.FREE),
      );
    await request(app.getHttpServer())
      .get('/auth/current-user')
      .set('Authorization', 'Bearer ' + body.accessToken)
      .expect(200)
      .expect(({ body }: { body: Record<string, unknown> }) =>
        expect(body).not.toHaveProperty('password'),
      );
  });

  it('rejects invalid, malformed, expired tokens and tenant selectors without activation', async () => {
    await register().expect(202);
    const token = lastToken();
    await verify('b'.repeat(43)).expect(400);
    await verify('malformed').expect(400);
    await request(app.getHttpServer())
      .post('/auth/verify-account')
      .send({ token, companyId: new Types.ObjectId().toString() })
      .expect(400);
    [...verifications.values()][0].expiresAt = new Date(Date.now() - 1);
    await verify(token).expect(400);
    expect([...companies.values()][0].activatedAt).toBeNull();
  });

  it('resends with generic responses, enforces cooldown, replaces old tokens and skips active/unknown accounts', async () => {
    await register().expect(202);
    const oldToken = lastToken();
    const resend = (email: string) =>
      request(app.getHttpServer())
        .post('/auth/resend-verification')
        .send({ email });
    await resend('owner@example.com')
      .expect(202)
      .expect(RESEND_VERIFICATION_RESPONSE);
    expect(sender.send).toHaveBeenCalledTimes(1);
    [...verifications.values()][0].lastSentAt = new Date(Date.now() - 61_000);
    await resend('OWNER@EXAMPLE.COM')
      .expect(202)
      .expect(RESEND_VERIFICATION_RESPONSE);
    expect(sender.send).toHaveBeenCalledTimes(2);
    const newToken = lastToken();
    expect(newToken).not.toBe(oldToken);
    await verify(oldToken).expect(400);
    await verify(newToken).expect(200);
    await resend('owner@example.com')
      .expect(202)
      .expect(RESEND_VERIFICATION_RESPONSE);
    await resend('unknown@example.com')
      .expect(202)
      .expect(RESEND_VERIFICATION_RESPONSE);
    expect(sender.send).toHaveBeenCalledTimes(2);
  });

  it('rate-limits public resend requests including unknown addresses', async () => {
    for (let index = 0; index < 5; index++) {
      await request(app.getHttpServer())
        .post('/auth/resend-verification')
        .send({ email: 'unknown@example.com' })
        .expect(202);
    }
    await request(app.getHttpServer())
      .post('/auth/resend-verification')
      .send({ email: 'unknown@example.com' })
      .expect(429);
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('keeps committed registration and Free subscription recoverable after SMTP failure', async () => {
    sender.send.mockRejectedValueOnce(new Error('SMTP unavailable'));
    await register().expect(503);
    expect(companies.size).toBe(1);
    expect(users.size).toBe(1);
    expect(subscriptions.size).toBe(1);
    [...verifications.values()][0].lastSentAt = new Date(Date.now() - 61_000);
    await request(app.getHttpServer())
      .post('/auth/resend-verification')
      .send({ email: 'owner@example.com' })
      .expect(202);
    await verify(lastToken()).expect(200);
  });

  it('never lets Google OAuth bypass company activation', async () => {
    await register().expect(202);
    await request(app.getHttpServer()).get('/auth/google/callback').expect(401);
    await verify(lastToken()).expect(200);
    await request(app.getHttpServer())
      .get('/auth/google/callback')
      .expect(302)
      .expect(({ headers }: { headers: Record<string, string> }) => {
        const redirect = new URL(headers.location);
        expect(redirect.origin).toBe('https://client.example.test');
        expect(redirect.searchParams.get('token')).toBeTruthy();
      });
  });

  it('activates only the token company and preserves tenant isolation', async () => {
    await register().expect(202);
    const firstToken = lastToken();
    const firstCompany = [...companies.values()][0];
    const firstOwner = [...users.values()][0];
    await register({ companyName: 'Other', email: 'other@example.com' }).expect(
      202,
    );
    const otherCompany = [...companies.values()][1];
    const otherOwner = [...users.values()][1];
    await verify(firstToken).expect(200);
    expect(firstCompany.activatedAt).not.toBeNull();
    expect(otherCompany.activatedAt).toBeNull();
    const otherJwt = app
      .get(JwtService)
      .sign({ id: otherOwner._id.toString() });
    await request(app.getHttpServer())
      .get('/companies/current')
      .set('Authorization', 'Bearer ' + otherJwt)
      .expect(401);
    const firstJwt = app
      .get(JwtService)
      .sign({ id: firstOwner._id.toString() });
    await request(app.getHttpServer())
      .get('/companies/current')
      .set('Authorization', 'Bearer ' + firstJwt)
      .expect(200)
      .expect(({ body }: { body: { _id: string } }) =>
        expect(body._id).toBe(firstCompany._id.toString()),
      );
  });

  it('preserves duplicate constraints and rolls back rejected onboarding', async () => {
    await register().expect(202);
    await register({ companyName: 'Different' }).expect(409);
    await register({ companyName: 'acme', email: 'other@example.com' }).expect(
      409,
    );
    expect(companies.size).toBe(1);
    expect(users.size).toBe(1);
    expect(subscriptions.size).toBe(1);
    expect(verifications.size).toBe(1);
    expect(sender.send).toHaveBeenCalledTimes(1);
  });
});
