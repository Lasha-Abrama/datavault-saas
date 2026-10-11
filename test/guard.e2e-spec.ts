import { INestApplication, Logger } from '@nestjs/common';
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
import { workbook, CANARIES } from './fixtures/guard/workbook';

// This suite uses a disposable localhost replica set, never a configured Mongo URI.
const body = (response: request.Response) =>
  response.body as {
    jobId: string;
    requestKey: string;
    status: string;
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
    const storage = {
      getObject: jest.fn(() =>
        Promise.resolve({
          stream: Readable.from(bytes),
          contentLength: bytes.length,
        }),
      ),
      putObject: jest.fn(),
      deleteObject: jest.fn(),
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
        controllers: [GuardController],
        providers: [
          IsAuthGuard,
          FilesService,
          GuardService,
          GuardAccessService,
          GuardRunner,
          GuardWorker,
          { provide: ObjectStorage, useValue: storage },
          { provide: EntitlementsService, useValue: {} },
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
        };
        await database.collection('guardjobs').insertOne(sentinel);
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
          /unexpected_child|unexpected_scan|unexpected_content_read|unexpected_parser_load|Guard worker unavailable/,
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
  },
);
