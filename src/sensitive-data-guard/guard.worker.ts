import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnApplicationBootstrap,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID, createHash } from 'node:crypto';
import { FilesService } from '../files/files.service';
import { GuardService, JobDocument } from './guard.service';
import { GuardRunner } from './guard.runner';
import {
  GUARD_LIMITS,
  GUARD_RUNTIME_POLICY,
  GuardRuntimePolicy,
  GuardLimits,
  ScanError,
  ScanResult,
} from './guard.constants';
@Injectable()
export class GuardWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private abort?: AbortController;
  private readonly logger = new Logger(GuardWorker.name);
  constructor(
    private readonly service: GuardService,
    private readonly files: FilesService,
    private readonly runner: GuardRunner,
    private readonly config: ConfigService,
    @Inject(GUARD_LIMITS) private readonly limits: GuardLimits,
    @Inject(GUARD_RUNTIME_POLICY) private readonly runtime: GuardRuntimePolicy,
  ) {}
  onApplicationBootstrap() {
    if (
      !this.runtime.isolationApproved ||
      this.config.get<string>('NODE_ENV') === 'test'
    )
      return;
    this.timer = setInterval(() => {
      void this.tick();
    }, 2000);
    this.timer.unref();
    void this.tick();
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.abort?.abort();
    await this.running;
  }
  async tick() {
    if (this.running || !this.runtime.isolationApproved) return;
    this.running = this.run();
    try {
      await this.running;
    } catch {
      this.logger.warn('Guard worker unavailable; recovery will retry');
    } finally {
      this.running = undefined;
    }
  }
  private async run() {
    await this.recover();
    const token = randomUUID();
    const job = await this.service.jobs.findOneAndUpdate(
      { status: 'queued', active: true },
      {
        $set: {
          status: 'processing',
          phase: 'fetching',
          leaseToken: token,
          leaseExpiresAt: new Date(Date.now() + this.limits.leaseMs),
          startedAt: new Date(),
        },
        $inc: { attempts: 1 },
      },
      { new: true, sort: { createdAt: 1 } },
    );
    if (!job) return;
    const controller = new AbortController();
    this.abort = controller;
    let checking = false;
    const heartbeat = setInterval(() => {
      if (checking) return;
      checking = true;
      void this.check(job, token)
        .then((ok) => {
          if (!ok) controller.abort();
        })
        .catch(() => controller.abort())
        .finally(() => {
          checking = false;
        });
    }, 1000);
    try {
      if (!(await this.check(job, token)))
        throw new ScanError('guard_access_revoked');
      const actor = await this.service.access.resolve(
        job.requestedBy.toString(),
        job.companyId.toString(),
        job.sourceFileId.toString(),
      );
      const bytes = await this.read(
        actor,
        job.sourceFileId.toString(),
        controller.signal,
      );
      if (!(await this.check(job, token)))
        throw new ScanError('guard_access_revoked');
      await this.service.jobs.updateOne(this.claim(job, token), {
        $set: { phase: 'scanning' },
      });
      const result = await this.runner.run(
        bytes,
        job.categories,
        job.phoneRegion,
        controller.signal,
      );
      await this.publish(
        job,
        token,
        result,
        createHash('sha256').update(bytes).digest('hex'),
      );
    } catch (error) {
      const code =
        error instanceof ScanError
          ? error.code
          : error instanceof NotFoundException
            ? 'guard_access_revoked'
            : 'guard_internal_error';
      await this.terminal(job, token, code);
    } finally {
      clearInterval(heartbeat);
      controller.abort();
      this.abort = undefined;
    }
  }
  private claim(job: JobDocument, token: string) {
    return {
      _id: job._id,
      companyId: job.companyId,
      status: 'processing',
      active: true,
      leaseToken: token,
      leaseExpiresAt: { $gt: new Date() },
    };
  }
  private async check(job: JobDocument, token: string) {
    if (!(await this.service.jobs.exists(this.claim(job, token)))) return false;
    await this.service.access.resolve(
      job.requestedBy.toString(),
      job.companyId.toString(),
      job.sourceFileId.toString(),
    );
    return true;
  }
  private async read(
    actor: Parameters<FilesService['download']>[0],
    fileId: string,
    signal: AbortSignal,
  ): Promise<Buffer> {
    // Bound download acquisition as well as stream consumption. A late stream is closed.
    let timedOut = false;
    const download = this.files.download(actor, fileId).then((result) => {
      if (timedOut || signal.aborted) result.stream.destroy();
      return result;
    });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new ScanError('guard_timeout'));
      }, this.limits.ioMs);
    });
    let stream: Awaited<typeof download>['stream'] | undefined;
    const abort = () => stream?.destroy(new ScanError('guard_access_revoked'));
    signal.addEventListener('abort', abort, { once: true });
    try {
      const stored = await Promise.race([download, timeout]);
      stream = stored.stream;
      if (signal.aborted) throw new ScanError('guard_access_revoked');
      if (
        stored.file.size > this.limits.compressedBytes ||
        (stored.contentLength ?? 0) > this.limits.compressedBytes
      )
        throw new ScanError('guard_limit_exceeded');
      const bytes = await Promise.race([
        (async () => {
          let length = 0;
          const chunks: Buffer[] = [];
          for await (const value of stored.stream) {
            const chunk = Buffer.from(value as Uint8Array);
            length += chunk.length;
            if (length > this.limits.compressedBytes)
              throw new ScanError('guard_limit_exceeded');
            chunks.push(chunk);
          }
          if (
            length !== stored.file.size ||
            (stored.contentLength !== undefined &&
              length !== stored.contentLength)
          )
            throw new ScanError('guard_invalid_workbook');
          return Buffer.concat(chunks);
        })(),
        timeout,
      ]);
      return bytes;
    } catch (error) {
      throw error instanceof ScanError
        ? error
        : new ScanError('guard_storage_unavailable');
    } finally {
      if (timer) clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      stream?.destroy();
    }
  }
  async publish(
    job: JobDocument,
    token: string,
    result: ScanResult,
    digest: string,
  ) {
    await this.service.connection.transaction(
      async (session) => {
        const claimed = await this.service.jobs.findOneAndUpdate(
          this.claim(job, token),
          { $set: { phase: 'completed' } },
          { session, new: true },
        );
        if (!claimed) return;
        // Writes shared fences: deletion/restriction/suspension conflicts before commit.
        await this.service.access.resolve(
          job.requestedBy.toString(),
          job.companyId.toString(),
          job.sourceFileId.toString(),
          session,
        );
        if (result.findings.length)
          await this.service.findings.insertMany(
            result.findings.map((f) => ({
              companyId: job.companyId,
              jobId: job._id,
              ordinal: f.ordinal,
              sheetIndex: f.sheetIndex,
              row: f.row,
              column: f.column,
              category: f.category,
              evidence: f.evidence,
              hidden: f.hidden,
            })),
            { session },
          );
        await this.service.jobs.updateOne(
          {
            _id: job._id,
            companyId: job.companyId,
            status: 'processing',
            active: true,
            leaseToken: token,
          },
          {
            $set: {
              status: 'completed',
              phase: 'completed',
              active: false,
              finishedAt: new Date(),
              processedCells: result.processedCells,
              findingCount: result.findings.length,
              sheets: result.sheets,
              compatibilityFlags: result.compatibilityFlags,
              coverage: result.coverage,
              sourceDigest: digest,
            },
            $unset: { leaseToken: 1, leaseExpiresAt: 1 },
          },
          { session },
        );
        await this.service.events.create(
          [
            {
              companyId: job.companyId,
              jobId: job._id,
              actorId: job.requestedBy,
              action: 'completed',
            },
          ],
          { session },
        );
      },
      { writeConcern: { w: 'majority' } },
    );
  }
  private async terminal(job: JobDocument, token: string, errorCode: string) {
    await this.service.connection.transaction(
      async (session) => {
        const result = await this.service.jobs.updateOne(
          this.claim(job, token),
          {
            $set: {
              status: 'failed',
              phase: 'failed',
              active: false,
              errorCode,
              finishedAt: new Date(),
            },
            $unset: { leaseToken: 1, leaseExpiresAt: 1 },
          },
          { session },
        );
        if (result.modifiedCount)
          await this.service.events.create(
            [
              {
                companyId: job.companyId,
                jobId: job._id,
                actorId: job.requestedBy,
                action: 'failed',
              },
            ],
            { session },
          );
      },
      { writeConcern: { w: 'majority' } },
    );
  }
  async recover() {
    const expired = await this.service.jobs
      .find({
        status: 'processing',
        active: true,
        leaseExpiresAt: { $lte: new Date() },
      })
      .select('+leaseToken')
      .limit(20);
    for (const job of expired) {
      const failed = job.attempts >= 3;
      await this.service.connection.transaction(
        async (session) => {
          const changed = await this.service.jobs.updateOne(
            {
              _id: job._id,
              companyId: job.companyId,
              status: 'processing',
              leaseToken: job.leaseToken,
              leaseExpiresAt: { $lte: new Date() },
            },
            {
              $set: failed
                ? {
                    status: 'failed',
                    phase: 'failed',
                    active: false,
                    errorCode: 'guard_timeout',
                    finishedAt: new Date(),
                  }
                : { status: 'queued', phase: 'queued' },
              $unset: { leaseToken: 1, leaseExpiresAt: 1 },
            },
            { session },
          );
          if (changed.modifiedCount)
            await this.service.events.create(
              [
                {
                  companyId: job.companyId,
                  jobId: job._id,
                  actorId: job.requestedBy,
                  action: failed ? 'failed' : 'queued',
                },
              ],
              { session },
            );
        },
        { writeConcern: { w: 'majority' } },
      );
    }
  }
}
