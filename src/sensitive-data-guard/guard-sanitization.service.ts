import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { ObjectStorage } from '../aws-s3/object-storage';
import { CompanyFileType } from '../files/entities/company-file.entity';
import { FilesService } from '../files/files.service';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { GuardService, JobDocument } from './guard.service';
import { GuardRunner } from './guard.runner';
import { GuardRedactDto } from './dto/guard-redact.dto';
import {
  GUARD_LIMITS,
  GuardLimits,
  GUARD_RUNTIME_POLICY,
  GuardRuntimePolicy,
  SANITIZATION_VERSION,
  ScanError,
} from './guard.constants';
const hash = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');
@Injectable()
export class GuardSanitizationService {
  constructor(
    private readonly service: GuardService,
    private readonly files: FilesService,
    private readonly storage: ObjectStorage,
    private readonly runner: GuardRunner,
    @Inject(GUARD_RUNTIME_POLICY) private readonly runtime: GuardRuntimePolicy,
    @Inject(GUARD_LIMITS) private readonly limits: GuardLimits,
  ) {}
  private approved() {
    if (!this.runtime.isolationApproved || !this.runtime.sanitizationApproved)
      throw new ServiceUnavailableException('guard_runtime_not_approved');
  }
  async submit(actor: AuthenticatedUser, scanId: string, dto: GuardRedactDto) {
    const scan = await this.service.authorized(actor, scanId);
    this.approved();
    if (
      scan.kind === 'sanitize' ||
      scan.status !== 'completed' ||
      scan.engineVersion !== 'ooxml_scan_v1'
    )
      throw new ConflictException('guard_scan_not_eligible');
    const source = await this.files.processingSource(
      actor,
      scan.sourceFileId.toString(),
    );
    if (source.derived || source.fileType !== CompanyFileType.XLSX)
      throw new ConflictException('guard_scan_not_eligible');
    const selection = {
      categories: [...dto.categories].sort(),
      columns: [...dto.columns]
        .sort((a, b) => a.sheetIndex - b.sheetIndex || a.column - b.column)
        .map((c) => ({
          sheetIndex: c.sheetIndex,
          column: c.column,
          includeHeader: c.includeHeader,
        })),
    };
    if (
      (!selection.categories.length && !selection.columns.length) ||
      selection.categories.some((c) => !scan.categories.includes(c)) ||
      selection.columns.some((c) => c.sheetIndex >= scan.sheets) ||
      new Set(selection.columns.map((c) => `${c.sheetIndex}:${c.column}`))
        .size !== selection.columns.length
    )
      throw new ConflictException('guard_selection_invalid');
    const fingerprint = hash(
      JSON.stringify({
        scanId: scan._id.toString(),
        selection,
        version: SANITIZATION_VERSION,
      }),
    );
    const identity = {
      companyId: actor.companyId,
      requestedBy: actor.id,
      requestKey: dto.requestKey.toLowerCase(),
    };
    const existing = await this.service.jobs
      .findOne(identity)
      .select('+fingerprint');
    if (existing) {
      if (existing.kind !== 'sanitize' || existing.fingerprint !== fingerprint)
        throw new ConflictException('guard_request_conflict');
      return this.service.publicJob(existing);
    }
    const id = new Types.ObjectId(),
      outputId = new Types.ObjectId();
    try {
      const job = await this.service.connection.transaction(
        async (session) => {
          await this.service.access.resolve(
            actor.id,
            actor.companyId,
            scan.sourceFileId.toString(),
            session,
          );
          const current = await this.service.jobs
            .findOne({
              _id: scan._id,
              companyId: actor.companyId,
              requestedBy: actor.id,
              status: 'completed',
            })
            .session(session)
            .select('+sourceDigest');
          if (!current?.sourceDigest)
            throw new ConflictException('guard_scan_not_eligible');
          if (
            (await this.service.jobs
              .countDocuments({
                companyId: actor.companyId,
                createdAt: { $gte: new Date(Date.now() - 60000) },
              })
              .session(session)) >= 10
          )
            throw new ConflictException('guard_rate_limited');
          const [created] = await this.service.jobs.create(
            [
              {
                _id: id,
                ...identity,
                kind: 'sanitize',
                scanId: scan._id,
                sourceFileId: scan.sourceFileId,
                fingerprint,
                categories: selection.categories,
                columns: selection.columns,
                resultFileId: outputId,
                outputStorageKey: `companies/${actor.companyId}/files/guard-${id.toString()}.xlsx`,
                sourceDigest: current.sourceDigest,
                engineVersion: SANITIZATION_VERSION,
              },
            ],
            { session },
          );
          await this.service.events.create(
            [
              {
                companyId: actor.companyId,
                jobId: id,
                actorId: actor.id,
                action: 'queued',
              },
            ],
            { session },
          );
          return created;
        },
        { writeConcern: { w: 'majority' } },
      );
      return this.service.publicJob(job);
    } catch (error) {
      // Lost acknowledgements and unique-key races recover by majority UUID lookup, never by deleting storage.
      const committed = await this.service.jobs
        .findOne(identity, null, {
          readPreference: 'primary',
          readConcern: { level: 'majority' },
        })
        .select('+fingerprint');
      if (
        committed &&
        committed.kind === 'sanitize' &&
        committed.fingerprint === fingerprint
      )
        return this.service.publicJob(committed);
      if (error instanceof ConflictException) throw error;
      throw new ConflictException('guard_admission_uncertain_or_busy');
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
  async process(
    job: JobDocument,
    token: string,
    bytes: Buffer,
    signal: AbortSignal,
  ) {
    this.approved();
    if (job.engineVersion !== SANITIZATION_VERSION)
      throw new ScanError('guard_profile_unsupported');
    const scan = await this.service.jobs
      .findOne({
        _id: job.scanId,
        companyId: job.companyId,
        requestedBy: job.requestedBy,
        status: 'completed',
      })
      .select('+sourceDigest');
    if (
      !scan ||
      scan.kind === 'sanitize' ||
      !scan.sourceDigest ||
      hash(bytes) !== scan.sourceDigest
    )
      throw new ScanError('guard_source_changed');
    const findings = await this.service.findings
      .find({ companyId: job.companyId, jobId: scan._id })
      .sort({ ordinal: 1 })
      .limit(this.limits.findings + 1);
    if (
      findings.length !== scan.findingCount ||
      findings.length > this.limits.findings
    )
      throw new ScanError('guard_source_changed');
    const safe = findings.map((f) => ({
      ordinal: f.ordinal,
      sheetIndex: f.sheetIndex,
      row: f.row,
      column: f.column,
      category: f.category,
      evidence: f.evidence,
      hidden: f.hidden,
    }));
    const result = await this.runner.sanitize(
      bytes,
      {
        categories: scan.categories,
        phoneRegion: scan.phoneRegion,
        findingsDigest: hash(JSON.stringify(safe)),
        selection: { categories: job.categories, columns: job.columns },
      },
      signal,
    );
    if (!job.outputStorageKey || !job.resultFileId || signal.aborted)
      throw new ScanError('guard_access_revoked');
    const actor = await this.service.connection.transaction(
      async (session) => {
        const current = await this.service.jobs
          .findOneAndUpdate(
            this.claim(job, token),
            {
              $set: {
                phase: 'publishing',
                cleanupPending: true,
                outputDigest: result.outputDigest,
              },
            },
            { session, new: true },
          )
          .select('+outputDigest');
        if (!current) throw new ScanError('guard_access_revoked');
        if (job.outputDigest && job.outputDigest !== result.outputDigest)
          throw new ScanError('guard_output_verification_failed');
        return this.service.access.resolve(
          job.requestedBy.toString(),
          job.companyId.toString(),
          job.sourceFileId.toString(),
          session,
        );
      },
      { writeConcern: { w: 'majority' } },
    );
    if (signal.aborted) throw new ScanError('guard_access_revoked');
    const abort = new AbortController();
    const cancel = () => abort.abort();
    signal.addEventListener('abort', cancel, { once: true });
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.storage.putObject({
          key: job.outputStorageKey,
          body: result.bytes,
          contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          signal: abort.signal,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            abort.abort();
            reject(new ScanError('guard_timeout'));
          }, this.limits.ioMs);
        }),
      ]);
      if (signal.aborted) throw new ScanError('guard_access_revoked');
      await this.service.connection.transaction(
        async (session) => {
          const current = await this.service.jobs.findOneAndUpdate(
            this.claim(job, token),
            { $set: { phase: 'publishing' } },
            { session, new: true },
          );
          if (!current) throw new ScanError('guard_access_revoked');
          const liveActor = await this.service.access.resolve(
            actor.id,
            actor.companyId,
            job.sourceFileId.toString(),
            session,
          );
          const fileId = await this.files.publishGuardCopy(
            liveActor,
            job.sourceFileId.toString(),
            {
              fileId: job.resultFileId!.toString(),
              jobId: job._id.toString(),
              storageKey: job.outputStorageKey!,
              size: result.bytes.length,
            },
            session,
          );
          const completed = await this.service.jobs.updateOne(
            this.claim(job, token),
            {
              $set: {
                status: 'completed',
                phase: 'completed',
                active: false,
                cleanupPending: false,
                finishedAt: new Date(),
                redactedCells: result.redactedCells,
                coverage: 'limited',
                resultFileId: fileId,
              },
              $unset: { leaseToken: 1, leaseExpiresAt: 1 },
            },
            { session },
          );
          if (completed.modifiedCount !== 1)
            throw new ScanError('guard_access_revoked');
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
    } catch (error) {
      if (error instanceof ForbiddenException)
        throw new ScanError('guard_quota_exceeded');
      if (error instanceof ScanError || error instanceof NotFoundException)
        throw error;
      // Commit/storage uncertainty retains cleanupPending and the stable object identity for recovery.
      throw new ScanError('guard_internal_error');
    } finally {
      if (timer) clearTimeout(timer);
      abort.abort();
      signal.removeEventListener('abort', cancel);
    }
  }
  async cleanup() {
    if (!this.runtime.isolationApproved || !this.runtime.sanitizationApproved)
      return;
    const pending = await this.service.jobs
      .find({
        kind: 'sanitize',
        active: false,
        $and: [{ $or: [{ cleanupPending: true }, { status: 'completed' }] }],
        $or: [
          { cleanupAfter: { $exists: false } },
          { cleanupAfter: { $lte: new Date() } },
        ],
      })
      .select('+outputStorageKey')
      .sort({ cleanupAfter: 1, _id: 1 })
      .limit(1);
    for (const job of pending) {
      // A committed file or uncertain majority read forbids destructive compensation.
      try {
        await this.service.jobs.updateOne(
          { _id: job._id, active: false },
          { $set: { cleanupAfter: new Date(Date.now() + 30000) } },
        );
        if (
          !job.outputStorageKey ||
          !job.resultFileId ||
          (await this.files.guardCopyExists(
            job.companyId.toString(),
            job.resultFileId.toString(),
          ))
        )
          continue;
        const expectedKey = `companies/${job.companyId.toString()}/files/guard-${job._id.toString()}.xlsx`;
        if (job.outputStorageKey !== expectedKey) continue;
        let deadline: NodeJS.Timeout | undefined;
        try {
          await Promise.race([
            this.storage.deleteObject(expectedKey),
            new Promise<never>((_, reject) => {
              deadline = setTimeout(
                () => reject(new ScanError('guard_timeout')),
                this.limits.ioMs,
              );
            }),
          ]);
        } finally {
          if (deadline) clearTimeout(deadline);
        }
        // Keep the tombstone: a timed-out remote PUT may still acknowledge later.
      } catch {
        /* Retry via durable tombstone without logging keys/provider errors. */
      }
    }
  }
  async history(
    actor: AuthenticatedUser,
    sourceId: string,
    query: { limit: number; after?: string; requestKey?: string },
  ) {
    await this.service.access.resolve(actor.id, actor.companyId, sourceId);
    const jobs = await this.service.jobs
      .find({
        companyId: actor.companyId,
        requestedBy: actor.id,
        sourceFileId: sourceId,
        kind: 'sanitize',
        status: 'completed',
        ...(query.requestKey
          ? { requestKey: query.requestKey.toLowerCase() }
          : {}),
        ...(query.after ? { _id: { $lt: query.after } } : {}),
      })
      .sort({ _id: -1 })
      .limit(query.limit + 1);
    const copies = [] as {
      jobId: string;
      fileId: string;
      strategyVersion: string;
      createdAt: Date;
    }[];
    for (const job of jobs.slice(0, query.limit))
      if (
        job.resultFileId &&
        (await this.files.guardCopyExists(
          actor.companyId,
          job.resultFileId.toString(),
        ))
      )
        copies.push({
          jobId: job._id.toString(),
          fileId: job.resultFileId.toString(),
          strategyVersion: job.engineVersion,
          createdAt: job.finishedAt!,
        });
    return {
      copies,
      nextCursor:
        jobs.length > query.limit ? jobs[query.limit - 1]._id.toString() : null,
    };
  }
}
