import { INestApplication, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { Readable } from 'stream';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { ObjectStorage } from '../src/aws-s3/object-storage';
import { configureApp } from '../src/config/configure-app';
import { EmailSender } from '../src/email/email-sender';
import { Role } from '../src/enums/roles.enum';
import { CompanyFileType } from '../src/files/entities/company-file.entity';
import { PlanCode } from '../src/plans/plan.constants';
import { billingPeriod } from '../src/subscriptions/billing-period';

interface UserState {
  _id: Types.ObjectId;
  companyId: Types.ObjectId;
  role: Role;
}

interface CompanyState {
  _id: Types.ObjectId;
  activatedAt: Date;
}

interface SubscriptionState {
  _id: Types.ObjectId;
  companyId: Types.ObjectId;
  planCode: PlanCode;
  activatedAt: Date;
  planChangedAt: Date;
  revision: number;
}

interface PeriodState {
  companyId: string;
  startsAt: Date;
  endsAt: Date;
  uploadedFiles: number;
  fileOverageCents: number;
}

interface FileState {
  _id: Types.ObjectId;
  companyId: string;
  uploaderId: string;
  originalFilename: string;
  storageKey: string;
  fileType: CompanyFileType;
  mimeType: string;
  size: number;
  createdAt: Date;
  updatedAt: Date;
}

function selectable<T>(value: T) {
  const promise = Promise.resolve(value);
  return Object.assign(promise, { select: () => promise });
}

function validXls() {
  const buffer = Buffer.alloc(512);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(buffer);
  buffer.writeUInt16LE(0xfffe, 28);
  buffer.writeUInt16LE(9, 30);
  Buffer.from('Workbook\0', 'utf16le').copy(buffer, 128);
  return buffer;
}

function validXlsx() {
  const names = ['[Content_Types].xml', 'xl/workbook.xml'];
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const value of names) {
    const name = Buffer.from(value);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.length + name.length;
  }
  const localData = Buffer.concat(localParts);
  const centralData = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(names.length, 8);
  eocd.writeUInt16LE(names.length, 10);
  eocd.writeUInt32LE(centralData.length, 12);
  eocd.writeUInt32LE(localData.length, 16);
  return Buffer.concat([localData, centralData, eocd]);
}

describe('company files (e2e)', () => {
  let app: INestApplication<App>;
  const companyId = new Types.ObjectId();
  const otherCompanyId = new Types.ObjectId();
  const ownerId = new Types.ObjectId();
  const memberId = new Types.ObjectId();
  const otherMemberId = new Types.ObjectId();
  const otherOwnerId = new Types.ObjectId();
  const users = new Map<string, UserState>();
  const companies = new Map<string, CompanyState>();
  const subscriptions = new Map<string, SubscriptionState>();
  const periods = new Map<string, PeriodState>();
  const files = new Map<string, FileState>();
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  let ownerToken: string;
  let memberToken: string;
  let otherMemberToken: string;
  let otherOwnerToken: string;
  let transactionTail = Promise.resolve();
  let failNextMetadataCreate = false;
  let failNextPut = false;
  let failNextDelete = false;

  beforeAll(async () => {
    const userModel = {
      findById: jest.fn((id: string) => Promise.resolve(users.get(id) ?? null)),
      countDocuments: jest.fn().mockResolvedValue(0),
      findOne: jest.fn().mockResolvedValue(null),
    };
    const companyModel = {
      findOne: jest.fn((filter: { _id: Types.ObjectId }) =>
        Promise.resolve(companies.get(filter._id.toString()) ?? null),
      ),
    };
    const subscriptionModel = {
      findOne: jest.fn((filter: { companyId: string }) =>
        Promise.resolve(subscriptions.get(String(filter.companyId)) ?? null),
      ),
      findOneAndUpdate: jest.fn(
        (filter: { companyId: string }, update: { $inc?: object }) => {
          const subscription = subscriptions.get(String(filter.companyId));
          if (!subscription) return Promise.resolve(null);
          if (update.$inc) subscription.revision++;
          return Promise.resolve(subscription);
        },
      ),
      create: jest.fn(),
    };
    const periodModel = {
      findOne: jest.fn((filter: { companyId: string; startsAt: Date }) => {
        const period = periods.get(String(filter.companyId));
        return Promise.resolve(
          period && period.startsAt.getTime() === filter.startsAt.getTime()
            ? period
            : null,
        );
      }),
      findOneAndUpdate: jest.fn(
        (
          filter: { companyId: string; startsAt: Date },
          update: {
            $setOnInsert: Omit<
              PeriodState,
              'uploadedFiles' | 'fileOverageCents'
            >;
            $inc: { uploadedFiles: number; fileOverageCents: number };
          },
        ) => {
          const key = String(filter.companyId);
          const period = periods.get(key) ?? {
            ...update.$setOnInsert,
            companyId: key,
            uploadedFiles: 0,
            fileOverageCents: 0,
          };
          period.uploadedFiles += update.$inc.uploadedFiles;
          period.fileOverageCents += update.$inc.fileOverageCents;
          periods.set(key, period);
          return Promise.resolve(period);
        },
      ),
    };
    const fileModel = {
      create: jest.fn(
        (inputs: Omit<FileState, '_id' | 'createdAt' | 'updatedAt'>[]) => {
          if (failNextMetadataCreate) {
            failNextMetadataCreate = false;
            throw new Error('metadata failure');
          }
          const now = new Date();
          const file = {
            ...inputs[0],
            _id: new Types.ObjectId(),
            createdAt: now,
            updatedAt: now,
          };
          files.set(file._id.toString(), file);
          return Promise.resolve([file]);
        },
      ),
      find: jest.fn((filter: { companyId: string }) => {
        let result = [...files.values()].filter(
          (file) => file.companyId === String(filter.companyId),
        );
        result.sort(
          (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
        );
        const query = {
          sort: () => query,
          skip: (count: number) => {
            result = result.slice(count);
            return query;
          },
          limit: (count: number) => Promise.resolve(result.slice(0, count)),
        };
        return query;
      }),
      countDocuments: jest.fn((filter: { companyId: string }) =>
        Promise.resolve(
          [...files.values()].filter(
            (file) => file.companyId === String(filter.companyId),
          ).length,
        ),
      ),
      findOne: jest.fn((filter: { _id: string; companyId: string }) =>
        selectable(
          [...files.values()].find(
            (file) =>
              file._id.toString() === String(filter._id) &&
              file.companyId === String(filter.companyId),
          ) ?? null,
        ),
      ),
      findOneAndDelete: jest.fn(
        (filter: { _id: string; companyId: string; storageKey: string }) => {
          const file = files.get(String(filter._id));
          if (
            !file ||
            file.companyId !== String(filter.companyId) ||
            file.storageKey !== filter.storageKey
          )
            return Promise.resolve(null);
          files.delete(file._id.toString());
          return Promise.resolve(file);
        },
      ),
    };
    const storage = {
      putObject: jest.fn(
        (input: { key: string; body: Buffer; contentType: string }) => {
          if (failNextPut) {
            failNextPut = false;
            throw new ServiceUnavailableException('S3 put failure');
          }
          objects.set(input.key, {
            body: Buffer.from(input.body),
            contentType: input.contentType,
          });
          return Promise.resolve();
        },
      ),
      getObject: jest.fn((key: string) => {
        const object = objects.get(key);
        if (!object) throw new Error('S3 object missing');
        return Promise.resolve({
          stream: Readable.from(object.body),
          contentLength: object.body.length,
        });
      }),
      deleteObject: jest.fn((key: string) => {
        if (failNextDelete) {
          failNextDelete = false;
          throw new ServiceUnavailableException('S3 delete failure');
        }
        objects.delete(key);
        return Promise.resolve();
      }),
    };
    const connection = {
      close: jest.fn(),
      transaction: jest.fn((work: (session: object) => Promise<unknown>) => {
        const run = transactionTail.then(async () => {
          const periodSnapshot = new Map(
            [...periods].map(([key, value]) => [key, { ...value }]),
          );
          const fileSnapshot = new Map(
            [...files].map(([key, value]) => [key, { ...value }]),
          );
          try {
            return await work({});
          } catch (error) {
            periods.clear();
            periodSnapshot.forEach((value, key) => periods.set(key, value));
            files.clear();
            fileSnapshot.forEach((value, key) => files.set(key, value));
            throw error;
          }
        });
        transactionTail = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      }),
    };

    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getConnectionToken())
      .useValue(connection)
      .overrideProvider(getModelToken('user'))
      .useValue(userModel)
      .overrideProvider(getModelToken('company'))
      .useValue(companyModel)
      .overrideProvider(getModelToken('subscription'))
      .useValue(subscriptionModel)
      .overrideProvider(getModelToken('subscriptionPeriod'))
      .useValue(periodModel)
      .overrideProvider(getModelToken('companyFile'))
      .useValue(fileModel)
      .overrideProvider(getModelToken('employeeInvitation'))
      .useValue({ countDocuments: jest.fn().mockResolvedValue(0) })
      .overrideProvider(getModelToken('companyVerification'))
      .useValue({})
      .overrideProvider(getModelToken('plan'))
      .useValue({ bulkWrite: jest.fn() })
      .overrideProvider(ObjectStorage)
      .useValue(storage)
      .overrideProvider(EmailSender)
      .useValue({ send: jest.fn() })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          JWT_SECRET: 'a-secure-test-secret-with-32-characters',
          FILE_MAX_SIZE_BYTES: 1024,
        }),
      )
      .compile();
    app = fixture.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    const jwt = app.get(JwtService);
    ownerToken = jwt.sign({ id: ownerId.toString() });
    memberToken = jwt.sign({ id: memberId.toString() });
    otherMemberToken = jwt.sign({ id: otherMemberId.toString() });
    otherOwnerToken = jwt.sign({ id: otherOwnerId.toString() });
  });

  beforeEach(() => {
    users.clear();
    companies.clear();
    subscriptions.clear();
    periods.clear();
    files.clear();
    objects.clear();
    failNextMetadataCreate = false;
    failNextPut = false;
    failNextDelete = false;
    transactionTail = Promise.resolve();
    const activatedAt = new Date('2026-01-15T12:00:00.000Z');
    for (const [id, tenantId, role] of [
      [ownerId, companyId, Role.COMPANY_OWNER],
      [memberId, companyId, Role.COMPANY_MEMBER],
      [otherMemberId, companyId, Role.COMPANY_MEMBER],
      [otherOwnerId, otherCompanyId, Role.COMPANY_OWNER],
    ] as const)
      users.set(id.toString(), { _id: id, companyId: tenantId, role });
    companies.set(companyId.toString(), { _id: companyId, activatedAt });
    companies.set(otherCompanyId.toString(), {
      _id: otherCompanyId,
      activatedAt,
    });
    for (const id of [companyId, otherCompanyId])
      subscriptions.set(id.toString(), {
        _id: new Types.ObjectId(),
        companyId: id,
        planCode: PlanCode.FREE,
        activatedAt,
        planChangedAt: activatedAt,
        revision: 0,
      });
  });

  afterAll(() => app?.close());

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const upload = (
    name: string,
    mime: string,
    body: Buffer,
    token = memberToken,
  ) =>
    request(app.getHttpServer())
      .post('/files')
      .set(auth(token))
      .attach('file', body, { filename: name, contentType: mime });

  const seedPeriod = (uploadedFiles: number) => {
    const subscription = subscriptions.get(companyId.toString())!;
    const period = billingPeriod(subscription.activatedAt, new Date());
    periods.set(companyId.toString(), {
      companyId: companyId.toString(),
      ...period,
      uploadedFiles,
      fileOverageCents: 0,
    });
  };

  it('accepts CSV, XLS, and XLSX for owners and members with private tenant keys', async () => {
    const cases: Array<[string, string, Buffer, string]> = [
      ['data.csv', 'text/csv', Buffer.from('a,b\n1,2'), memberToken],
      ['legacy.xls', 'application/vnd.ms-excel', validXls(), ownerToken],
      [
        'book.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        validXlsx(),
        memberToken,
      ],
    ];
    for (const [name, mime, body, token] of cases)
      await upload(name, mime, body, token)
        .expect(201)
        .expect(({ body: response }: { body: Record<string, unknown> }) => {
          expect(response).not.toHaveProperty('storageKey');
          expect(response).not.toHaveProperty('buffer');
        });
    expect(files.size).toBe(3);
    expect(
      [...objects.keys()].every((key) =>
        key.startsWith(`companies/${companyId.toString()}/files/`),
      ),
    ).toBe(true);
  });

  it('rejects missing, empty, oversized, unsupported, mismatched, malformed, and injected uploads', async () => {
    await request(app.getHttpServer())
      .post('/files')
      .attach('file', Buffer.from('a,b'), {
        filename: 'data.csv',
        contentType: 'text/csv',
      })
      .expect(401);
    await request(app.getHttpServer())
      .post('/files')
      .set(auth(memberToken))
      .expect(400);
    await upload('empty.csv', 'text/csv', Buffer.alloc(0)).expect(400);
    await upload('large.csv', 'text/csv', Buffer.alloc(1025, 65)).expect(413);
    await upload('data.pdf', 'application/pdf', Buffer.from('x')).expect(400);
    await upload('data.xlsx', 'text/csv', validXlsx()).expect(400);
    await upload(
      'data.csv',
      'application/octet-stream',
      Buffer.from('a,b'),
    ).expect(400);
    await upload(
      'spoofed.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.from('[Content_Types].xml xl/workbook.xml'),
      ]),
    ).expect(400);
    await upload('data.csv', 'text/csv', Buffer.from([0, 1, 2])).expect(400);
    await upload(
      'data.xls',
      'application/vnd.ms-excel',
      Buffer.alloc(512),
    ).expect(400);
    await request(app.getHttpServer())
      .post('/files')
      .set(auth(memberToken))
      .field('companyId', otherCompanyId.toString())
      .field('uploaderId', otherOwnerId.toString())
      .field('storageKey', 'arbitrary')
      .attach('file', Buffer.from('a,b\n1,2'), {
        filename: 'data.csv',
        contentType: 'text/csv',
      })
      .expect(400);
    expect(files.size).toBe(0);
    expect(objects.size).toBe(0);
  });

  it('enforces Free and Basic hard limits and Premium overage', async () => {
    seedPeriod(9);
    await upload('free-last.csv', 'text/csv', Buffer.from('a,b')).expect(201);
    await upload('free-over.csv', 'text/csv', Buffer.from('a,b')).expect(403);

    subscriptions.get(companyId.toString())!.planCode = PlanCode.BASIC;
    periods.get(companyId.toString())!.uploadedFiles = 99;
    await upload('basic-last.csv', 'text/csv', Buffer.from('a,b')).expect(201);
    await upload('basic-over.csv', 'text/csv', Buffer.from('a,b')).expect(403);

    subscriptions.get(companyId.toString())!.planCode = PlanCode.PREMIUM;
    periods.get(companyId.toString())!.uploadedFiles = 999;
    await upload('premium-1000.csv', 'text/csv', Buffer.from('a,b')).expect(
      201,
    );
    await upload('premium-1001.csv', 'text/csv', Buffer.from('a,b')).expect(
      201,
    );
    expect(periods.get(companyId.toString())).toMatchObject({
      uploadedFiles: 1001,
      fileOverageCents: 50,
    });
  });

  it('serializes concurrent final-slot uploads and cleans up the rejected object', async () => {
    seedPeriod(9);
    const responses = await Promise.all([
      upload('first.csv', 'text/csv', Buffer.from('a,b')),
      upload('second.csv', 'text/csv', Buffer.from('a,b')),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 403,
    ]);
    expect(files.size).toBe(1);
    expect(objects.size).toBe(1);
    expect(periods.get(companyId.toString())?.uploadedFiles).toBe(10);
  });

  it('does not consume quota on S3 failure and compensates metadata failure', async () => {
    failNextPut = true;
    await upload('storage.csv', 'text/csv', Buffer.from('a,b')).expect(503);
    expect(periods.size).toBe(0);
    expect(objects.size).toBe(0);

    failNextMetadataCreate = true;
    await upload('metadata.csv', 'text/csv', Buffer.from('a,b')).expect(500);
    expect(periods.size).toBe(0);
    expect(files.size).toBe(0);
    expect(objects.size).toBe(0);
  });

  it('paginates metadata and hides cross-tenant identifiers', async () => {
    const createdAt = new Date();
    for (let index = 0; index < 31; index++) {
      const id = new Types.ObjectId();
      files.set(id.toString(), {
        _id: id,
        companyId: companyId.toString(),
        uploaderId: memberId.toString(),
        originalFilename: `${index}.csv`,
        storageKey: `companies/${companyId.toString()}/files/${index}.csv`,
        fileType: CompanyFileType.CSV,
        mimeType: 'text/csv',
        size: 3,
        createdAt,
        updatedAt: createdAt,
      });
    }
    const targetId = [...files.keys()][0];
    await request(app.getHttpServer())
      .get('/files?page=2&take=30')
      .set(auth(memberToken))
      .expect(200)
      .expect(({ body }: { body: { total: number; files: object[] } }) => {
        expect(body.total).toBe(31);
        expect(body.files).toHaveLength(1);
        expect(JSON.stringify(body)).not.toContain('storageKey');
      });
    await request(app.getHttpServer())
      .get(`/files/${targetId}`)
      .set(auth(otherOwnerToken))
      .expect(404);
    await request(app.getHttpServer())
      .get('/files/not-an-id')
      .set(auth(memberToken))
      .expect(400);
  });

  it('streams downloads privately and applies uploader/owner deletion rules without refunding quota', async () => {
    const uploaded = await upload(
      '../safe.csv',
      'text/csv',
      Buffer.from('a,b\n1,2'),
    ).expect(201);
    const body = uploaded.body as unknown as { id: string };
    const periodBeforeDelete = periods.get(companyId.toString())!.uploadedFiles;
    await request(app.getHttpServer())
      .get(`/files/${body.id}/download`)
      .set(auth(memberToken))
      .expect('Content-Type', /text\/csv/)
      .expect('Content-Disposition', /attachment/)
      .expect('Cache-Control', 'private, no-store')
      .expect('X-Content-Type-Options', 'nosniff')
      .expect(200);
    await request(app.getHttpServer())
      .get(`/files/${body.id}/download`)
      .set(auth(otherOwnerToken))
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/files/${body.id}`)
      .set(auth(otherMemberToken))
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/files/${body.id}`)
      .set(auth(ownerToken))
      .expect(200);
    expect(files.size).toBe(0);
    expect(objects.size).toBe(0);
    expect(periods.get(companyId.toString())!.uploadedFiles).toBe(
      periodBeforeDelete,
    );
  });

  it('keeps metadata retryable when S3 deletion fails', async () => {
    const uploaded = await upload(
      'safe.csv',
      'text/csv',
      Buffer.from('a,b'),
    ).expect(201);
    const body = uploaded.body as unknown as { id: string };
    failNextDelete = true;
    await request(app.getHttpServer())
      .delete(`/files/${body.id}`)
      .set(auth(memberToken))
      .expect(503);
    expect(files.has(body.id)).toBe(true);
    expect(objects.size).toBe(1);
  });
});
