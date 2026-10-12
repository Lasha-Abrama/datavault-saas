import { INestApplication, Logger, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { spawn, spawnSync, ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { Readable } from 'node:stream';
import { Connection, Model, Types } from 'mongoose';
import { MongoClient } from 'mongodb';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../src/config/configure-app';
import { IsAuthGuard } from '../src/guards/is-auth.guard';
import { userSchema } from '../src/users/entities/user.entity';
import { companySchema } from '../src/companies/entities/company.entity';
import {
  companyFileSchema,
  CompanyFile,
} from '../src/files/entities/company-file.entity';
import { FilesController } from '../src/files/files.controller';
import { GuardSanitizationService } from '../src/sensitive-data-guard/guard-sanitization.service';
import { FilesService } from '../src/files/files.service';
import { ObjectStorage } from '../src/aws-s3/object-storage';
import { EntitlementsService } from '../src/subscriptions/entitlements.service';
import { GuardController } from '../src/sensitive-data-guard/guard.controller';
import { GuardService } from '../src/sensitive-data-guard/guard.service';
import { GuardWorker } from '../src/sensitive-data-guard/guard.worker';
import { GuardRunner } from '../src/sensitive-data-guard/guard.runner';
import { GuardAccessService } from '../src/sensitive-data-guard/guard-access.service';
import {
  GuardJob,
  guardJobSchema,
} from '../src/sensitive-data-guard/entities/guard-job.entity';
import {
  GuardFinding,
  guardFindingSchema,
} from '../src/sensitive-data-guard/entities/guard-finding.entity';
import { guardEventSchema } from '../src/sensitive-data-guard/entities/guard-event.entity';
import {
  CATEGORIES,
  DEFAULT_LIMITS,
  GUARD_LIMITS,
  GUARD_RUNTIME_POLICY,
  GuardRuntimePolicy,
  DEFAULT_RUNTIME_POLICY,
} from '../src/sensitive-data-guard/guard.constants';
import { workbook, plainWorkbook, CANARIES } from './fixtures/guard/workbook';

// This suite uses a disposable localhost replica set, never a configured Mongo URI.
const body = (response: request.Response) =>
  response.body as {
    jobId: string;
    requestKey: string;
    status: string;
    kind: string;
    resultFileId: string;
    redactedCells: number;
    errorCode?: string;
    copies: { fileId: string }[];
    jobs: unknown[];
    findings: { ordinal: number }[];
    nextCursor: number | null;
  };
const available =
  spawnSync('mongod', ['--version'], { stdio: 'ignore' }).status === 0;
(available ? describe : describe.skip)(
  'Guard real replica-set HTTP/lifecycle (requires mongod and build)',
  () => {
    let app: INestApplication<App>,
      daemon: ChildProcess,
      directory: string,
      mongoPort: number;
    let jobs: Model<GuardJob>,
      findings: Model<GuardFinding>,
      files: Model<CompanyFile>,
      worker: GuardWorker;
    const tenant = new Types.ObjectId(),
      otherTenant = new Types.ObjectId(),
      owner = new Types.ObjectId(),
      member = new Types.ObjectId(),
      outsider = new Types.ObjectId();
    let fileId: string,
      token: string,
      ownerToken: string,
      outsiderToken: string;
    let runner: GuardRunner;
    const bytes = workbook();
    const objects = new Map<string, Buffer>();
    let quotaLimit = 100;
    const entitlements = { recordFileUploads: jest.fn() };
    const storage = {
      getObject: jest.fn((key: string) =>
        Promise.resolve({
          stream: Readable.from(objects.get(key) ?? bytes),
          contentLength: (objects.get(key) ?? bytes).length,
        }),
      ),
      putObject: jest.fn((input: { key: string; body: Buffer }) => {
        objects.set(input.key, Buffer.from(input.body));
        return Promise.resolve();
      }),
      deleteObject: jest.fn((key: string) => {
        objects.delete(key);
        return Promise.resolve();
      }),
    };
    beforeAll(async () => {
      const port = await new Promise<number>((resolve, reject) => {
        const server = createServer();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
          const address = server.address() as { port: number };
          server.close(() => resolve(address.port));
        });
      });
      mongoPort = port;
      directory = mkdtempSync(join(tmpdir(), 'datavault-guard-test-'));
      daemon = spawn(
        'mongod',
        [
          '--dbpath',
          directory,
          '--bind_ip',
          '127.0.0.1',
          '--port',
          String(port),
          '--replSet',
          'guardtest',
          '--quiet',
        ],
        { stdio: 'ignore' },
      );
      const directUri = `mongodb://127.0.0.1:${port}/guard_test?directConnection=true`;
      const client = new MongoClient(directUri, {
        serverSelectionTimeoutMS: 500,
      });
      let connected = false;
      for (let i = 0; i < 60; i++) {
        try {
          await client.connect();
          connected = true;
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      if (!connected) throw new Error('Disposable MongoDB failed to start');
      await client.db('admin').command({
        replSetInitiate: {
          _id: 'guardtest',
          members: [{ _id: 0, host: `127.0.0.1:${port}` }],
        },
      });
      for (let i = 0; i < 100; i++) {
        if ((await client.db('admin').command({ hello: 1 })).isWritablePrimary)
          break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await client.close();
      const module = await Test.createTestingModule({
        imports: [
          MongooseModule.forRoot(
            `mongodb://127.0.0.1:${port}/guard_test?replicaSet=guardtest`,
          ),
          MongooseModule.forFeature([
            { name: 'user', schema: userSchema },
            { name: 'company', schema: companySchema },
            { name: 'companyFile', schema: companyFileSchema },
            { name: 'guardJob', schema: guardJobSchema },
            { name: 'guardFinding', schema: guardFindingSchema },
            { name: 'guardEvent', schema: guardEventSchema },
          ]),
          JwtModule.register({
            secret: 'guard-test-only-secret-with-at-least-32-characters',
          }),
        ],
        controllers: [GuardController, FilesController],
        providers: [
          IsAuthGuard,
          FilesService,
          GuardService,
          GuardSanitizationService,
          GuardAccessService,
          GuardRunner,
          GuardWorker,
          { provide: ObjectStorage, useValue: storage },
          { provide: EntitlementsService, useValue: entitlements },
          {
            provide: ConfigService,
            useValue: new ConfigService({
              NODE_ENV: 'test',
              TRUST_PROXY_HOPS: 0,
              FILE_MAX_SIZE_BYTES: DEFAULT_LIMITS.compressedBytes,
            }),
          },
          { provide: GUARD_LIMITS, useValue: DEFAULT_LIMITS },
          {
            provide: GUARD_RUNTIME_POLICY,
            useValue: { isolationApproved: true },
          },
        ],
      }).compile();
      app = module.createNestApplication();
      configureApp(app);
      await app.init();
      const connection = module.get<Connection>(getConnectionToken());
      await Promise.all(Object.values(connection.models).map((m) => m.init()));
      for (const name of ['guardJob', 'guardFinding', 'guardEvent']) {
        const model = module.get<Model<object>>(getModelToken(name));
        await model.createCollection();
        await model.createIndexes();
      }
      jobs = module.get(getModelToken('guardJob'));
      findings = module.get(getModelToken('guardFinding'));
      files = module.get(getModelToken('companyFile'));
      entitlements.recordFileUploads.mockImplementation(
        async (
          companyId: string,
          quantity: number,
          _at: Date,
          session: import('mongoose').ClientSession,
        ) => {
          if (
            (await files.countDocuments({ companyId }).session(session)) >=
            quotaLimit
          )
            throw new ForbiddenException('synthetic quota denial');
          await module
            .get<Model<object>>(getModelToken('company'))
            .collection.updateOne(
              { _id: new Types.ObjectId(companyId) },
              { $inc: { syntheticUploads: quantity } },
              { session },
            );
        },
      );
      worker = module.get(GuardWorker);
      runner = module.get(GuardRunner);
      await module
        .get<Model<object>>(getModelToken('company'))
        .collection.insertMany([
          {
            _id: tenant,
            name: 'Guard tenant',
            country: 'GE',
            industry: 'test',
            activatedAt: new Date(),
            platformStatus: 'active',
          },
          {
            _id: otherTenant,
            name: 'Other',
            activatedAt: new Date(),
            platformStatus: 'active',
          },
        ]);
      await module
        .get<Model<object>>(getModelToken('user'))
        .collection.insertMany([
          {
            _id: owner,
            companyId: tenant,
            role: 'company_owner',
            email: 'owner@example.invalid',
          },
          {
            _id: member,
            companyId: tenant,
            role: 'company_member',
            email: 'member@example.invalid',
          },
          {
            _id: outsider,
            companyId: otherTenant,
            role: 'company_owner',
            email: 'outsider@example.invalid',
          },
        ]);
      const jwt = module.get(JwtService);
      token = jwt.sign({ id: member.toString() });
      ownerToken = jwt.sign({ id: owner.toString() });
      outsiderToken = jwt.sign({ id: outsider.toString() });
    }, 30000);
    afterAll(async () => {
      await app?.close();
      if (daemon && daemon.exitCode === null) {
        daemon.kill('SIGTERM');
        await new Promise<void>((resolve) =>
          daemon.once('exit', () => resolve()),
        );
      }
      if (directory) rmSync(directory, { recursive: true, force: true });
    });
    it('starts the compiled production API without Guard configuration or database initialization', async () => {
      const port = await new Promise<number>((resolvePort, reject) => {
        const server = createServer();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
          const address = server.address() as { port: number };
          server.close(() => resolvePort(address.port));
        });
      });
      const uri = `mongodb://127.0.0.1:${mongoPort}/guard_disabled_smoke?replicaSet=guardtest`;
      const client = new MongoClient(uri);
      await client.connect();
      const database = client.db();
      const entry = resolve(__dirname, '../dist/main.js');
      const guardDirectory = resolve(__dirname, '../dist/sensitive-data-guard');
      // Fail the smoke test if startup attempts parsing, private content reads or child creation.
      const script = `
        require('node:child_process').spawn = () => { throw new Error('unexpected_child'); };
        require(${JSON.stringify(join(guardDirectory, 'guard.runner.js'))}).GuardRunner.prototype.run = () => { throw new Error('unexpected_scan'); };
        require(${JSON.stringify(join(guardDirectory, 'guard.runner.js'))}).GuardRunner.prototype.sanitize = () => { throw new Error('unexpected_sanitize'); };
        require(${JSON.stringify(resolve(__dirname, '../dist/files/files.service.js'))}).FilesService.prototype.download = () => { throw new Error('unexpected_content_read'); };
        require(${JSON.stringify(entry)});
        if (Object.keys(require.cache).some(p => /(?:scan-child|scan-workbook)\\.js$/.test(p))) throw new Error('unexpected_parser_load');
      `;
      const process = spawn(global.process.execPath, ['-e', script], {
        // A temporary working directory prevents dotenv from reading the repository's .env.
        cwd: directory,
        env: {
          NODE_ENV: 'production',
          PORT: String(port),
          MONGO_URI: uri,
          JWT_SECRET: 'guard-test-only-secret-with-at-least-32-characters',
          ACCOUNT_ACTIVATION_URL: 'http://localhost:3000/activate',
          EMPLOYEE_INVITATION_URL: 'http://localhost:3000/employee-activate',
          EMAIL_PROVIDER: 'smtp',
          SMTP_HOST: 'localhost',
          SMTP_FROM: 'test@example.invalid',
          AWS_EC2_METADATA_DISABLED: 'true',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      const collect = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-128 * 1024);
      };
      process.stdout?.on('data', collect);
      process.stderr?.on('data', collect);
      const origin = `http://127.0.0.1:${port}`;
      try {
        let ready = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          if (process.exitCode !== null)
            throw new Error('Production startup exited');
          try {
            ready = (
              await fetch(`${origin}/health/ready`, {
                signal: AbortSignal.timeout(500),
              })
            ).ok;
          } catch {
            /* Local listener is not ready yet. */
          }
          if (ready) break;
          await new Promise((resolveWait) => setTimeout(resolveWait, 100));
        }
        expect(ready).toBe(true);
        expect((await fetch(`${origin}/health/live`)).status).toBe(200);
        const names = (await database.listCollections().toArray()).map(
          (c) => c.name,
        );
        expect(names).not.toEqual(expect.arrayContaining(['guardjobs']));
        expect(names).not.toEqual(expect.arrayContaining(['guardfindings']));
        expect(names).not.toEqual(expect.arrayContaining(['guardevents']));
        await database.collection('companies').insertOne({
          _id: tenant,
          activatedAt: new Date(),
          platformStatus: 'active',
        });
        await database.collection('users').insertOne({
          _id: member,
          companyId: tenant,
          role: 'company_member',
          email: 'smoke@example.invalid',
        });
        await database.collection('companyfiles').insertOne({
          _id: new Types.ObjectId(fileId),
          companyId: tenant,
          uploaderId: member,
          visibility: 'company_wide',
          fileType: 'xlsx',
          size: bytes.length,
        });
        const response = await fetch(`${origin}/files/${fileId}/guard/scans`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requestKey: '11111111-1111-4111-8111-111111111111',
            categories: ['email'],
          }),
        });
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({
          message: 'guard_runtime_not_approved',
        });
        expect(await database.collection('guardjobs').countDocuments()).toBe(0);
        const sentinel = {
          _id: new Types.ObjectId(),
          status: 'queued',
          active: true,
          companyId: tenant,
          requestedBy: member,
          sourceFileId: new Types.ObjectId(fileId),
        };
        await database.collection('guardjobs').insertOne(sentinel);
        const disabledCopy = await fetch(
          `${origin}/guard/scans/${sentinel._id.toString()}/copies`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              requestKey: '22222222-2222-4222-8222-222222222222',
              categories: ['email'],
            }),
          },
        );
        expect(disabledCopy.status).toBe(503);
        expect(await database.collection('guardjobs').countDocuments()).toBe(1);
        await new Promise((resolveWait) => setTimeout(resolveWait, 2300));
        expect(
          await database.collection('guardjobs').findOne({ _id: sentinel._id }),
        ).toEqual(sentinel);
        expect(
          (await database.collection('guardjobs').listIndexes().toArray()).map(
            (i: { name: string }) => i.name,
          ),
        ).toEqual(['_id_']);
        expect(output).not.toMatch(
          /unexpected_child|unexpected_scan|unexpected_sanitize|unexpected_content_read|unexpected_parser_load|Guard worker unavailable/,
        );
        expect(
          (await fetch(`${origin}/guard/jobs/${sentinel._id.toString()}`))
            .status,
        ).toBe(401);
      } finally {
        if (process.exitCode === null) {
          const exited = new Promise<void>((resolveExit) =>
            process.once('exit', () => resolveExit()),
          );
          process.kill('SIGTERM');
          await exited;
        }
        await client.close();
      }
    }, 30000);

    beforeEach(async () => {
      jest.restoreAllMocks();
      storage.putObject.mockClear();
      storage.deleteObject.mockClear();
      entitlements.recordFileUploads.mockClear();
      objects.clear();
      quotaLimit = 100;
      app.get<GuardRuntimePolicy>(GUARD_RUNTIME_POLICY).sanitizationApproved =
        false;
      await app
        .get<Model<object>>(getModelToken('company'))
        .collection.updateOne(
          { _id: tenant },
          { $set: { syntheticUploads: 0 } },
        );
      await jobs.deleteMany({});
      await findings.deleteMany({});
      await files.deleteMany({});
      const file = await files.create({
        companyId: tenant,
        uploaderId: owner,
        storageKey: `companies/${tenant.toString()}/files/${new Types.ObjectId().toString()}.xlsx`,
        originalFilename: 'synthetic.xlsx',
        fileType: 'xlsx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: bytes.length,
        visibility: 'company_wide',
      });
      fileId = file._id.toString();
    });
    const post = (key = crypto.randomUUID()) =>
      request(app.getHttpServer())
        .post(`/files/${fileId}/guard/scans`)
        .auth(token, { type: 'bearer' })
        .send({ requestKey: key, categories: [...CATEGORIES] });
    async function submit() {
      const response = await post().expect(202);
      return body(response).jobId;
    }
    it('fails closed until deployment isolation is approved', async () => {
      expect(DEFAULT_RUNTIME_POLICY.isolationApproved).toBe(false);
      const runtime = app.get<GuardRuntimePolicy>(GUARD_RUNTIME_POLICY);
      runtime.isolationApproved = false;
      try {
        await post().expect(503);
        expect(await jobs.countDocuments()).toBe(0);
        await worker.tick();
      } finally {
        runtime.isolationApproved = true;
      }
    });
    it('fails safely when storage returns an error or malformed bytes', async () => {
      const id = await submit();
      storage.getObject.mockRejectedValueOnce(
        new Error('private storage diagnostic'),
      );
      await worker.tick();
      expect((await jobs.findById(id))?.errorCode).toBe(
        'guard_storage_unavailable',
      );
      const response = await request(app.getHttpServer())
        .get(`/guard/jobs/${id}`)
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(JSON.stringify(body(response))).not.toContain(
        'private storage diagnostic',
      );
      const second = await submit();
      storage.getObject.mockResolvedValueOnce({
        stream: Readable.from(Buffer.alloc(bytes.length)),
        contentLength: bytes.length,
      });
      await worker.tick();
      expect((await jobs.findById(second))?.errorCode).toBe(
        'guard_invalid_workbook',
      );
      expect(await findings.countDocuments()).toBe(0);
    });
    it('enforces auth purpose, tenant isolation, requester-only access and strict inputs', async () => {
      await request(app.getHttpServer())
        .post(`/files/${fileId}/guard/scans`)
        .send({})
        .expect(401);
      await request(app.getHttpServer())
        .post(`/files/${fileId}/guard/scans`)
        .auth(outsiderToken, { type: 'bearer' })
        .send({ requestKey: crypto.randomUUID(), categories: ['email'] })
        .expect(404);
      await request(app.getHttpServer())
        .post(`/files/${fileId}/guard/scans`)
        .auth(token, { type: 'bearer' })
        .send({
          requestKey: crypto.randomUUID(),
          categories: ['email'],
          companyId: otherTenant,
        })
        .expect(400);
      const id = await submit();
      for (const bearer of [ownerToken, outsiderToken])
        await request(app.getHttpServer())
          .get(`/guard/jobs/${id}`)
          .auth(bearer, { type: 'bearer' })
          .expect(404);
      const jwt = app.get(JwtService);
      await request(app.getHttpServer())
        .get(`/guard/jobs/${id}`)
        .auth(jwt.sign({ id: member.toString(), type: 'platform_admin' }), {
          type: 'bearer',
        })
        .expect(401);
    });
    it('keeps historical findings private and scoped while admission and processing are disabled', async () => {
      const id = await submit();
      await worker.tick();
      const runtime = app.get<GuardRuntimePolicy>(GUARD_RUNTIME_POLICY);
      runtime.isolationApproved = false;
      const run = jest.spyOn(runner, 'run');
      const read = jest.spyOn(storage, 'getObject');
      read.mockClear();
      try {
        await worker.tick();
        await post().expect(503);
        const response = await request(app.getHttpServer())
          .get(`/guard/scans/${id}/findings`)
          .auth(token, { type: 'bearer' })
          .expect('Cache-Control', 'private, no-store')
          .expect(200);
        for (const value of CANARIES)
          expect(JSON.stringify(response.body)).not.toContain(value);
        for (const denied of [outsiderToken, ownerToken]) {
          await request(app.getHttpServer())
            .get(`/guard/scans/${id}/findings`)
            .auth(denied, { type: 'bearer' })
            .expect(404);
          await request(app.getHttpServer())
            .get(`/guard/jobs/${id}`)
            .auth(denied, { type: 'bearer' })
            .expect(404);
        }
        await files.updateOne(
          { _id: fileId },
          { $set: { visibility: 'restricted', restrictedUserIds: [] } },
        );
        await request(app.getHttpServer())
          .get(`/guard/scans/${id}/findings`)
          .auth(token, { type: 'bearer' })
          .expect(404);
        expect(run).not.toHaveBeenCalled();
        expect(read).not.toHaveBeenCalled();
      } finally {
        runtime.isolationApproved = true;
      }
    });
    it('rejects ineligible formats, oversized sources and unbounded queries', async () => {
      await files.collection.updateOne(
        { _id: new Types.ObjectId(fileId) },
        { $set: { fileType: 'csv' } },
      );
      await post().expect(400);
      await files.collection.updateOne(
        { _id: new Types.ObjectId(fileId) },
        {
          $set: { fileType: 'xlsx', size: DEFAULT_LIMITS.compressedBytes + 1 },
        },
      );
      await post().expect(413);
      expect(await jobs.countDocuments()).toBe(0);
      await request(app.getHttpServer())
        .get(`/files/${fileId}/guard/jobs?limit=1000`)
        .auth(token, { type: 'bearer' })
        .expect(400);
    });
    it('aborts publication when a source restriction races the transaction snapshot', async () => {
      const id = await submit();
      const access = app.get(GuardAccessService);
      const original = access.resolve.bind(access);
      let revoked = false;
      jest.spyOn(access, 'resolve').mockImplementation(async (...args) => {
        if (args[3] && !revoked) {
          revoked = true;
          await files.updateOne(
            { _id: fileId },
            { $set: { visibility: 'restricted', restrictedUserIds: [] } },
          );
        }
        return original(...args);
      });
      await worker.tick();
      expect(revoked).toBe(true);
      expect((await jobs.findById(id))?.status).toBe('failed');
      expect(await findings.countDocuments({ jobId: id })).toBe(0);
    });
    it('deduplicates simultaneous requests and blocks another active tenant scan', async () => {
      const key = crypto.randomUUID();
      const responses = await Promise.all([post(key), post(key)]);
      expect(responses.map((r) => r.status)).toEqual([202, 202]);
      expect(body(responses[0]).jobId).toBe(body(responses[1]).jobId);
      expect(await jobs.countDocuments()).toBe(1);
      await post().expect(409);
      await request(app.getHttpServer())
        .post(`/files/${fileId}/guard/scans`)
        .auth(token, { type: 'bearer' })
        .send({ requestKey: key, categories: ['ip'] })
        .expect(409);
    });
    it('publishes metadata-only findings atomically, paginates and leaves storage unchanged', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn'),
        error = jest.spyOn(Logger.prototype, 'error');
      const id = await submit();
      await worker.tick();
      const status = await request(app.getHttpServer())
        .get(`/guard/jobs/${id}`)
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(body(status)).toMatchObject({
        status: 'completed',
        findingCount: 6,
        generationEligible: false,
        coverage: 'limited',
      });
      const first = await request(app.getHttpServer())
        .get(`/guard/scans/${id}/findings?limit=2`)
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(body(first).findings).toHaveLength(2);
      expect(body(first).nextCursor).toBe(1);
      const next = await request(app.getHttpServer())
        .get(`/guard/scans/${id}/findings?limit=2&after=1`)
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(body(next).findings[0].ordinal).toBe(2);
      const persisted = JSON.stringify({
        jobs: await jobs.find().lean(),
        findings: await findings.find().lean(),
        status: body(status),
        first: body(first),
        logs: [warn.mock.calls, error.mock.calls],
      });
      for (const value of [...CANARIES, 'private person', 'private bank'])
        expect(persisted).not.toContain(value);
      expect(storage.putObject).not.toHaveBeenCalled();
      expect(storage.deleteObject).not.toHaveBeenCalled();
      await request(app.getHttpServer())
        .get(
          `/files/${fileId}/guard/jobs?requestKey=${body(status).requestKey}`,
        )
        .auth(token, { type: 'bearer' })
        .expect(200)
        .expect((r) => expect(body(r).jobs).toHaveLength(1));
    });
    it.each([
      'permissions',
      'delete',
      'cancel',
      'suspend',
      'user_delete',
    ] as const)(
      'prevents publication after %s during parsing',
      async (action) => {
        const original = runner.run.bind(runner);
        let entered!: () => void, release!: () => void;
        const enteredPromise = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const wait = new Promise<void>((resolve) => {
          release = resolve;
        });
        jest.spyOn(runner, 'run').mockImplementation(async (...args) => {
          entered();
          await wait;
          return original(...args);
        });
        const id = await submit();
        const processing = worker.tick();
        await enteredPromise;
        if (action === 'permissions')
          await files.updateOne(
            { _id: fileId },
            { $set: { visibility: 'restricted', restrictedUserIds: [] } },
          );
        if (action === 'delete') await files.deleteOne({ _id: fileId });
        if (action === 'suspend')
          await app
            .get<Model<object>>(getModelToken('company'))
            .updateOne(
              { _id: tenant },
              { $set: { platformStatus: 'suspended' } },
            );
        if (action === 'user_delete')
          await app
            .get<Model<object>>(getModelToken('user'))
            .deleteOne({ _id: member });
        if (action === 'cancel')
          await request(app.getHttpServer())
            .post(`/guard/jobs/${id}/cancel`)
            .auth(token, { type: 'bearer' })
            .send({})
            .expect(200);
        release();
        await processing;
        expect(await findings.countDocuments({ jobId: id })).toBe(0);
        expect((await jobs.findById(id))?.status).toBe(
          action === 'cancel' ? 'cancelled' : 'failed',
        );
        if (['permissions', 'delete'].includes(action))
          await request(app.getHttpServer())
            .get(`/guard/jobs/${id}`)
            .auth(token, { type: 'bearer' })
            .expect(404);
        if (action === 'suspend')
          await app
            .get<Model<object>>(getModelToken('company'))
            .updateOne({ _id: tenant }, { $set: { platformStatus: 'active' } });
        if (action === 'user_delete')
          await app
            .get<Model<object>>(getModelToken('user'))
            .collection.insertOne({
              _id: member,
              companyId: tenant,
              role: 'company_member',
              email: 'member@example.invalid',
            });
      },
    );
    it('cancels queued jobs idempotently and recovers expired leases with a bounded retry count', async () => {
      const id = await submit();
      for (let i = 0; i < 2; i++)
        await request(app.getHttpServer())
          .post(`/guard/jobs/${id}/cancel`)
          .auth(token, { type: 'bearer' })
          .send({})
          .expect(200)
          .expect((r) => expect(body(r).status).toBe('cancelled'));
      await worker.tick();
      expect(await findings.countDocuments()).toBe(0);
      const retry = await submit();
      await jobs.updateOne(
        { _id: retry },
        {
          $set: {
            status: 'processing',
            leaseToken: 'old',
            leaseExpiresAt: new Date(0),
            attempts: 1,
          },
        },
      );
      await worker.recover();
      expect((await jobs.findById(retry))?.status).toBe('queued');
      await jobs.updateOne(
        { _id: retry },
        {
          $set: {
            status: 'processing',
            leaseToken: 'old',
            leaseExpiresAt: new Date(0),
            attempts: 3,
          },
        },
      );
      await worker.recover();
      expect((await jobs.findById(retry))?.status).toBe('failed');
    });
    it('rejects stale lease publication and verifies schema indexes on a real replica set', async () => {
      const id = await submit();
      const job = (await jobs.findById(id))!;
      await worker.publish(
        job,
        'stale',
        {
          findings: [],
          processedCells: 1,
          sheets: 1,
          compatibilityFlags: [],
          coverage: 'limited',
        },
        'digest',
      );
      expect((await jobs.findById(id))?.status).toBe('queued');
      expect(await findings.countDocuments()).toBe(0);
      const indexes = await jobs.collection.indexes();
      expect(
        indexes.some(
          (index) =>
            index.unique && index.partialFilterExpression?.active === true,
        ),
      ).toBe(true);
    });

    describe('sanitization publication and lifecycle', () => {
      let scanId: string, sourceKey: string;
      beforeEach(async () => {
        const file = (await files.findById(fileId).select('+storageKey'))!;
        sourceKey = file.storageKey;
        const original = plainWorkbook();
        objects.set(sourceKey, original);
        await files.collection.updateOne(
          { _id: new Types.ObjectId(fileId) },
          { $set: { size: original.length } },
        );
        scanId = await submit();
        await worker.tick();
        expect((await jobs.findById(scanId))?.status).toBe('completed');
        app.get<GuardRuntimePolicy>(GUARD_RUNTIME_POLICY).sanitizationApproved =
          true;
      });
      const redact = (
        id: string,
        key = crypto.randomUUID(),
        auth = token,
        extra: Record<string, unknown> = {},
      ) =>
        request(app.getHttpServer())
          .post(`/guard/scans/${id}/copies`)
          .auth(auth, { type: 'bearer' })
          .send({ requestKey: key, categories: [...CATEGORIES], ...extra });
      const runCopy = async () => {
        const submitted = await redact(scanId).expect(202);
        const id = body(submitted).jobId;
        await worker.tick();
        const result = await request(app.getHttpServer())
          .get(`/guard/jobs/${id}`)
          .auth(token, { type: 'bearer' })
          .expect(200);
        return { id, response: result, fileId: body(result).resultFileId };
      };
      it('publishes one separate private copy, charges once and supports download/history/deletion', async () => {
        const before = await files.findById(fileId).lean(),
          original = Buffer.from(objects.get(sourceKey)!);
        const key = crypto.randomUUID();
        const submitted = await redact(scanId, key, token, {
          columns: [{ sheetIndex: 0, column: 4, includeHeader: true }],
        }).expect(202);
        const id = body(submitted).jobId;
        await worker.tick();
        const result = await request(app.getHttpServer())
          .get(`/guard/jobs/${id}`)
          .auth(token, { type: 'bearer' })
          .expect(200);
        expect(body(result)).toMatchObject({
          status: 'completed',
          kind: 'sanitize',
          redactedCells: 7,
        });
        const outputId = body(result).resultFileId;
        expect(outputId).not.toBe(fileId);
        expect(await files.findById(fileId).lean()).toEqual(before);
        expect(objects.get(sourceKey)?.equals(original)).toBe(true);
        const output = (await files.findById(outputId).select('+storageKey'))!;
        expect(output.derivation?.sourceFileId.toString()).toBe(fileId);
        expect(output.storageKey).not.toBe(sourceKey);
        expect(output.visibility).toBe('restricted');
        const downloaded = await request(app.getHttpServer())
          .get(`/files/${outputId}/download`)
          .auth(token, { type: 'bearer' })
          .buffer(true)
          .parse((response, done) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () => done(null, Buffer.concat(chunks)));
            response.on('error', (error: Error) => done(error, undefined));
          })
          .expect(200);
        expect(
          (downloaded.body as Buffer).equals(objects.get(output.storageKey)!),
        ).toBe(true);
        for (const raw of CANARIES)
          expect(objects.get(output.storageKey)!.toString()).not.toContain(raw);
        const history = await request(app.getHttpServer())
          .get(`/files/${fileId}/guard/copies`)
          .auth(token, { type: 'bearer' })
          .expect(200);
        expect(body(history).copies.map((c) => c.fileId)).toEqual([outputId]);
        expect(JSON.stringify([body(result), body(history)])).not.toMatch(
          /outputStorageKey|outputDigest|storageKey|private person/,
        );
        const replay = await redact(scanId, key, token, {
          columns: [{ sheetIndex: 0, column: 4, includeHeader: true }],
        }).expect(202);
        expect(body(replay).jobId).toBe(id);
        await worker.tick();
        expect(await files.countDocuments()).toBe(2);
        expect(storage.putObject).toHaveBeenCalledTimes(1);
        const usage = await app
          .get<Model<object>>(getModelToken('company'))
          .collection.findOne({ _id: tenant });
        expect(usage?.syntheticUploads).toBe(1);
        const lateBytes = Buffer.from(objects.get(output.storageKey)!);
        await request(app.getHttpServer())
          .delete(`/files/${outputId}`)
          .auth(token, { type: 'bearer' })
          .expect(200);
        expect(objects.has(output.storageKey)).toBe(false);
        expect(await files.findById(fileId)).not.toBeNull();
        expect(
          (await jobs.findById(id).select('+cleanupPending'))?.cleanupPending,
        ).toBe(true);
        objects.set(output.storageKey, lateBytes);
        await jobs.updateOne(
          { _id: id },
          { $set: { cleanupAfter: new Date(0) } },
        );
        await worker.tick();
        expect(objects.has(output.storageKey)).toBe(false);
        expect(objects.get(sourceKey)?.equals(original)).toBe(true);
      });
      it('rejects sanitization unless both runtime approvals are present', async () => {
        const runtime = app.get<GuardRuntimePolicy>(GUARD_RUNTIME_POLICY);
        runtime.sanitizationApproved = false;
        await redact(scanId).expect(503);
        runtime.sanitizationApproved = true;
        runtime.isolationApproved = false;
        try {
          await redact(scanId).expect(503);
          await worker.tick();
          expect(storage.putObject).not.toHaveBeenCalled();
        } finally {
          runtime.isolationApproved = true;
        }
        expect(await jobs.countDocuments({ kind: 'sanitize' })).toBe(0);
      });
      it('validates nested selections and rejects cross-tenant or other-requester scans', async () => {
        await redact(scanId, crypto.randomUUID(), outsiderToken).expect(404);
        await redact(scanId, crypto.randomUUID(), ownerToken).expect(404);
        for (const invalid of [
          { companyId: tenant.toString() },
          { categories: [] },
          { columns: [{ sheetIndex: 100, column: 1, includeHeader: true }] },
          {
            columns: [
              {
                sheetIndex: 0,
                column: 1,
                includeHeader: true,
                value: 'private data',
              },
            ],
          },
          {
            columns: [
              { sheetIndex: 0, column: 1, includeHeader: true },
              { sheetIndex: 0, column: 1, includeHeader: false },
            ],
          },
        ]) {
          const response = await redact(
            scanId,
            crypto.randomUUID(),
            token,
            invalid,
          );
          expect([400, 409]).toContain(response.status);
        }
        expect(await jobs.countDocuments({ kind: 'sanitize' })).toBe(0);
      });
      it('deduplicates concurrent UUIDs and rejects changed bodies or another active copy', async () => {
        const key = crypto.randomUUID();
        const results = await Promise.all([
          redact(scanId, key),
          redact(scanId, key),
        ]);
        expect(results.map((r) => r.status)).toEqual([202, 202]);
        expect(body(results[0]).jobId).toBe(body(results[1]).jobId);
        await redact(scanId, key, token, { categories: ['email'] }).expect(409);
        await redact(scanId).expect(409);
        await worker.tick();
        expect(await files.countDocuments()).toBe(2);
        expect(storage.putObject).toHaveBeenCalledTimes(1);
      });
      it('rejects changed source bytes and unsupported workbook profiles without putting output', async () => {
        objects.set(sourceKey, Buffer.alloc(plainWorkbook().length));
        const result = await runCopy();
        expect(body(result.response)).toMatchObject({
          status: 'failed',
          errorCode: 'guard_source_changed',
        });
        expect(storage.putObject).not.toHaveBeenCalled();
      });
      it('handles quota denial after storage and keeps durable compensation without reserving quota', async () => {
        quotaLimit = 1;
        const result = await runCopy();
        expect(body(result.response)).toMatchObject({
          status: 'failed',
          errorCode: 'guard_quota_exceeded',
        });
        expect(await files.countDocuments()).toBe(1);
        expect(
          (await jobs.findById(result.id).select('+cleanupPending'))
            ?.cleanupPending,
        ).toBe(true);
        await worker.tick();
        expect([...objects.keys()]).toEqual([sourceKey]);
        expect(storage.deleteObject).toHaveBeenCalledTimes(1);
      });
      it('retains recovery records when PUT succeeds but its acknowledgement fails', async () => {
        jest.spyOn(storage, 'putObject').mockImplementationOnce((input) => {
          objects.set(input.key, Buffer.from(input.body));
          return Promise.reject(new Error(CANARIES[0]));
        });
        const result = await runCopy();
        expect(body(result.response)).toMatchObject({
          status: 'failed',
          errorCode: 'guard_internal_error',
        });
        expect(JSON.stringify(body(result.response))).not.toContain(
          CANARIES[0],
        );
        expect(await files.countDocuments()).toBe(1);
        await worker.tick();
        expect([...objects.keys()]).toEqual([sourceKey]);
      });
      it('rolls back metadata and accounting if publication fails after file creation', async () => {
        const svc = app.get(FilesService),
          original = svc.publishGuardCopy.bind(svc);
        jest
          .spyOn(svc, 'publishGuardCopy')
          .mockImplementationOnce(async (...args) => {
            await original(...args);
            throw new Error('synthetic publication failure');
          });
        const result = await runCopy();
        expect(body(result.response).status).toBe('failed');
        expect(await files.countDocuments()).toBe(1);
        const company = await app
          .get<Model<object>>(getModelToken('company'))
          .collection.findOne({ _id: tenant });
        expect(company?.syntheticUploads).toBe(0);
        await worker.tick();
        expect([...objects.keys()]).toEqual([sourceKey]);
      });
      it.each(['cancel', 'restrict', 'delete', 'company', 'user'])(
        'cannot publish after %s during the storage write',
        async (mode) => {
          jest
            .spyOn(storage, 'putObject')
            .mockImplementationOnce(async (input) => {
              objects.set(input.key, Buffer.from(input.body));
              const active = (await jobs.findOne({
                kind: 'sanitize',
                active: true,
              }))!;
              if (mode === 'cancel')
                await request(app.getHttpServer())
                  .post(`/guard/jobs/${active._id.toString()}/cancel`)
                  .auth(token, { type: 'bearer' })
                  .send({})
                  .expect(200);
              if (mode === 'restrict')
                await files.updateOne(
                  { _id: fileId },
                  { $set: { visibility: 'restricted', restrictedUserIds: [] } },
                );
              if (mode === 'delete') await files.deleteOne({ _id: fileId });
              if (mode === 'company')
                await app
                  .get<Model<object>>(getModelToken('company'))
                  .collection.updateOne(
                    { _id: tenant },
                    { $set: { platformStatus: 'suspended' } },
                  );
              if (mode === 'user')
                await app
                  .get<Model<object>>(getModelToken('user'))
                  .collection.updateOne(
                    { _id: member },
                    { $set: { companyId: otherTenant } },
                  );
            });
          const submitted = await redact(scanId).expect(202);
          const id = body(submitted).jobId;
          try {
            await worker.tick();
            expect(
              await files.countDocuments({ derivation: { $exists: true } }),
            ).toBe(0);
            expect((await jobs.findById(id))?.status).not.toBe('completed');
            await worker.tick();
            expect([...objects.keys()]).toEqual([sourceKey]);
          } finally {
            await app
              .get<Model<object>>(getModelToken('company'))
              .collection.updateOne(
                { _id: tenant },
                { $set: { platformStatus: 'active' } },
              );
            await app
              .get<Model<object>>(getModelToken('user'))
              .collection.updateOne(
                { _id: member },
                { $set: { companyId: tenant } },
              );
          }
        },
      );
      it('rejects a completed scan whose workbook contains formulas before writing storage', async () => {
        objects.set(sourceKey, bytes);
        await files.collection.updateOne(
          { _id: new Types.ObjectId(fileId) },
          { $set: { size: bytes.length } },
        );
        scanId = await submit();
        await worker.tick();
        const result = await runCopy();
        expect(body(result.response)).toMatchObject({
          status: 'failed',
          errorCode: 'guard_profile_unsupported',
        });
        expect(storage.putObject).not.toHaveBeenCalled();
      });
      it('cancels queued copies without writing storage or recording upload usage', async () => {
        const response = await redact(scanId).expect(202);
        await request(app.getHttpServer())
          .post(`/guard/jobs/${body(response).jobId}/cancel`)
          .auth(token, { type: 'bearer' })
          .send({})
          .expect(200);
        await worker.tick();
        expect(storage.putObject).not.toHaveBeenCalled();
        expect(entitlements.recordFileUploads).not.toHaveBeenCalled();
      });
      it('preserves an acknowledged database commit after the publication response is lost', async () => {
        const response = await redact(scanId).expect(202),
          id = body(response).jobId;
        const connection = app.get<Connection>(getConnectionToken());
        const original = connection.transaction.bind(connection);
        let transactions = 0;
        jest
          .spyOn(connection, 'transaction')
          .mockImplementation(async (fn, options) => {
            const result = await original(fn, options);
            transactions++;
            if (transactions === 2)
              throw new Error('synthetic lost commit acknowledgement');
            return result;
          });
        await worker.tick();
        const job = (await jobs.findById(id))!;
        expect(job.status).toBe('completed');
        expect(await files.countDocuments()).toBe(2);
        await worker.tick();
        expect(storage.deleteObject).not.toHaveBeenCalled();
        expect(storage.putObject).toHaveBeenCalledTimes(1);
      });
      it('never stores or logs detected values and retries failed orphan cleanup durably', async () => {
        const warn = jest.spyOn(Logger.prototype, 'warn'),
          error = jest.spyOn(Logger.prototype, 'error');
        quotaLimit = 1;
        const result = await runCopy();
        jest
          .spyOn(storage, 'deleteObject')
          .mockRejectedValueOnce(new Error(CANARIES[0]));
        await worker.tick();
        expect(
          (await jobs.findById(result.id).select('+cleanupPending'))
            ?.cleanupPending,
        ).toBe(true);
        await jobs.updateOne(
          { _id: result.id },
          { $set: { cleanupAfter: new Date(0) } },
        );
        await worker.tick();
        expect([...objects.keys()]).toEqual([sourceKey]);
        const recorded = JSON.stringify({
          jobs: await jobs
            .find()
            .select(
              '+fingerprint +sourceDigest +outputStorageKey +outputDigest',
            )
            .lean(),
          findings: await findings.find().lean(),
          logs: [warn.mock.calls, error.mock.calls],
          response: body(result.response),
        });
        for (const raw of [...CANARIES, 'private person', 'private bank'])
          expect(recorded).not.toContain(raw);
      });
      it('checks lineage for metadata, listing and downloads while preserving derived deletion rights', async () => {
        const copy = await runCopy();
        expect(body(copy.response).status).toBe('completed');
        await request(app.getHttpServer())
          .get(`/files/${copy.fileId}/download`)
          .auth(outsiderToken, { type: 'bearer' })
          .expect(404);
        await request(app.getHttpServer())
          .patch(`/files/${copy.fileId}/permissions`)
          .auth(token, { type: 'bearer' })
          .send({ visibility: 'company_wide' })
          .expect(403);
        await files.updateOne(
          { _id: fileId },
          { $set: { visibility: 'restricted', restrictedUserIds: [] } },
        );
        await request(app.getHttpServer())
          .get(`/files/${copy.fileId}`)
          .auth(token, { type: 'bearer' })
          .expect(404);
        await request(app.getHttpServer())
          .get(`/files/${copy.fileId}/download`)
          .auth(token, { type: 'bearer' })
          .expect(404);
        const listed = await request(app.getHttpServer())
          .get('/files?page=1&take=30')
          .auth(token, { type: 'bearer' })
          .expect(200);
        expect(JSON.stringify(listed.body)).not.toContain(copy.fileId);
        await request(app.getHttpServer())
          .delete(`/files/${copy.fileId}`)
          .auth(token, { type: 'bearer' })
          .expect(200);
      });
      it('recovers an expired sanitization lease with the same output identity and charges once', async () => {
        const submitted = await redact(scanId).expect(202),
          id = body(submitted).jobId;
        const initial = (await jobs.findById(id).select('+outputStorageKey'))!;
        await jobs.updateOne(
          { _id: id },
          {
            $set: {
              status: 'processing',
              attempts: 1,
              leaseToken: 'crashed',
              leaseExpiresAt: new Date(0),
              cleanupPending: true,
            },
          },
        );
        objects.set(
          initial.outputStorageKey!,
          Buffer.from('uncertain temporary object'),
        );
        await worker.tick();
        const recovered = (await jobs
          .findById(id)
          .select('+outputStorageKey'))!;
        expect(recovered.status).toBe('completed');
        expect(recovered.outputStorageKey).toBe(initial.outputStorageKey);
        expect(recovered.resultFileId?.equals(initial.resultFileId)).toBe(true);
        expect(await files.countDocuments()).toBe(2);
        expect(storage.putObject).toHaveBeenCalledTimes(1);
      });
    });
  },
);
