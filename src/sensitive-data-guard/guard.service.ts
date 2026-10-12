import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Inject,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import { Connection, HydratedDocument, Model } from 'mongoose';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { CompanyFileType } from '../files/entities/company-file.entity';
import { FilesService } from '../files/files.service';
import { GuardJob } from './entities/guard-job.entity';
import { GuardFinding } from './entities/guard-finding.entity';
import { GuardEvent } from './entities/guard-event.entity';
import { GuardAccessService } from './guard-access.service';
import { GuardScanDto } from './dto/guard-scan.dto';
import { GuardJobsQueryDto, GuardQueryDto } from './dto/guard-query.dto';
import {
  GUARD_RUNTIME_POLICY,
  GuardRuntimePolicy,
  GUARD_LIMITS,
  GuardLimits,
} from './guard.constants';
export type JobDocument = HydratedDocument<GuardJob>;
@Injectable()
export class GuardService {
  constructor(
    @InjectModel('guardJob') readonly jobs: Model<GuardJob>,
    @InjectModel('guardFinding') readonly findings: Model<GuardFinding>,
    @InjectModel('guardEvent') readonly events: Model<GuardEvent>,
    @InjectConnection() readonly connection: Connection,
    readonly access: GuardAccessService,
    private readonly files: FilesService,
    @Inject(GUARD_RUNTIME_POLICY) private readonly runtime: GuardRuntimePolicy,
    @Inject(GUARD_LIMITS) private readonly limits: GuardLimits,
  ) {}
  async submit(actor: AuthenticatedUser, fileId: string, dto: GuardScanDto) {
    await this.access.resolve(actor.id, actor.companyId, fileId);
    const source = await this.files.processingSource(actor, fileId);
    if (source.fileType !== CompanyFileType.XLSX)
      throw new BadRequestException('guard_unsupported_format');
    if (source.size > this.limits.compressedBytes)
      throw new HttpException('guard_limit_exceeded', 413);
    if (!this.runtime.isolationApproved)
      throw new ServiceUnavailableException('guard_runtime_not_approved');
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          fileId: fileId.toLowerCase(),
          categories: [...dto.categories].sort(),
          phoneRegion: dto.phoneRegion ?? null,
        }),
      )
      .digest('hex');
    const identity = {
      companyId: actor.companyId,
      requestedBy: actor.id,
      requestKey: dto.requestKey.toLowerCase(),
    };
    const existing = await this.jobs.findOne(identity).select('+fingerprint');
    if (existing) return this.replay(existing, fingerprint);
    // Admission rate remains durable across cancellation and process restarts.
    if (
      (await this.jobs.countDocuments({
        companyId: actor.companyId,
        createdAt: { $gte: new Date(Date.now() - 60000) },
      })) >= 10
    )
      throw new HttpException('guard_rate_limited', 429);
    try {
      const job = await this.connection.transaction(
        async (session) => {
          await this.access.resolve(actor.id, actor.companyId, fileId, session);
          if (
            (await this.jobs
              .countDocuments({
                companyId: actor.companyId,
                createdAt: { $gte: new Date(Date.now() - 60000) },
              })
              .session(session)) >= 10
          )
            throw new HttpException('guard_rate_limited', 429);
          const [created] = await this.jobs.create(
            [
              {
                ...identity,
                sourceFileId: fileId,
                fingerprint,
                categories: [...dto.categories].sort(),
                phoneRegion: dto.phoneRegion,
              },
            ],
            { session },
          );
          await this.events.create(
            [
              {
                companyId: actor.companyId,
                jobId: created._id,
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
      return this.publicJob(job);
    } catch (error) {
      // Read durable identity after both unique collisions and uncertain commits.
      const committed = await this.jobs
        .findOne(identity, null, {
          readPreference: 'primary',
          readConcern: { level: 'majority' },
        })
        .select('+fingerprint');
      if (committed) return this.replay(committed, fingerprint);
      if ((error as { code?: number }).code === 11000)
        throw new ConflictException('guard_active_scan_exists');
      if (error instanceof NotFoundException || error instanceof HttpException)
        throw error;
      throw new ServiceUnavailableException('guard_submission_unconfirmed');
    }
  }
  private replay(job: JobDocument, fingerprint: string) {
    if (job.fingerprint !== fingerprint)
      throw new ConflictException('guard_request_conflict');
    return this.publicJob(job);
  }
  async authorized(actor: AuthenticatedUser, id: string) {
    const job = await this.jobs.findOne({
      _id: id,
      companyId: actor.companyId,
      requestedBy: actor.id,
    });
    if (!job) throw new NotFoundException('Scan not found');
    try {
      await this.access.resolve(
        actor.id,
        actor.companyId,
        job.sourceFileId.toString(),
      );
    } catch {
      throw new NotFoundException('Scan not found');
    }
    return job;
  }
  async status(actor: AuthenticatedUser, id: string) {
    return this.publicJob(await this.authorized(actor, id));
  }
  async list(
    actor: AuthenticatedUser,
    fileId: string,
    query: GuardJobsQueryDto,
  ) {
    await this.access.resolve(actor.id, actor.companyId, fileId);
    const jobs = await this.jobs
      .find({
        companyId: actor.companyId,
        requestedBy: actor.id,
        sourceFileId: fileId,
        ...(query.after ? { _id: { $lt: query.after } } : {}),
        ...(query.requestKey
          ? { requestKey: query.requestKey.toLowerCase() }
          : {}),
      })
      .sort({ _id: -1 })
      .limit(query.limit + 1);
    return {
      jobs: jobs.slice(0, query.limit).map((j) => this.publicJob(j)),
      nextCursor:
        jobs.length > query.limit ? jobs[query.limit - 1]._id.toString() : null,
    };
  }
  async listFindings(
    actor: AuthenticatedUser,
    id: string,
    query: GuardQueryDto,
  ) {
    const job = await this.authorized(actor, id);
    if (job.kind === 'sanitize' || job.status !== 'completed')
      throw new ConflictException('guard_scan_not_completed');
    const results = await this.findings
      .find({
        companyId: actor.companyId,
        jobId: id,
        ordinal: { $gt: query.after ?? -1 },
      })
      .sort({ ordinal: 1 })
      .limit(query.limit + 1);
    return {
      findings: results.slice(0, query.limit).map((f) => ({
        ordinal: f.ordinal,
        sheetIndex: f.sheetIndex,
        row: f.row,
        column: f.column,
        category: f.category,
        evidence: f.evidence,
        hidden: f.hidden,
      })),
      nextCursor:
        results.length > query.limit ? results[query.limit - 1].ordinal : null,
    };
  }
  async cancel(actor: AuthenticatedUser, id: string) {
    const job = await this.authorized(actor, id);
    await this.connection.transaction(
      async (session) => {
        await this.access.resolve(
          actor.id,
          actor.companyId,
          job.sourceFileId.toString(),
          session,
        );
        const changed = await this.jobs.updateOne(
          {
            _id: id,
            companyId: actor.companyId,
            requestedBy: actor.id,
            active: true,
          },
          {
            $set: {
              status: 'cancelled',
              phase: 'cancelled',
              active: false,
              finishedAt: new Date(),
            },
            $unset: { leaseToken: 1, leaseExpiresAt: 1 },
          },
          { session },
        );
        if (changed.modifiedCount)
          await this.events.create(
            [
              {
                companyId: actor.companyId,
                jobId: id,
                actorId: actor.id,
                action: 'cancelled',
              },
            ],
            { session },
          );
      },
      { writeConcern: { w: 'majority' } },
    );
    return this.status(actor, id);
  }
  publicJob(job: JobDocument) {
    return {
      jobId: job._id.toString(),
      kind: job.kind ?? 'scan',
      ...(job.kind === 'sanitize'
        ? {
            scanId: job.scanId?.toString(),
            resultFileId:
              job.status === 'completed' ? job.resultFileId?.toString() : null,
            redactedCells: job.redactedCells,
            transformationScope: 'selected_supported_cells',
          }
        : {}),
      sourceFileId: job.sourceFileId.toString(),
      requestKey: job.requestKey,
      status: job.status,
      phase: job.phase,
      createdAt: job.createdAt,
      startedAt: job.startedAt ?? null,
      finishedAt: job.finishedAt ?? null,
      errorCode: job.errorCode ?? null,
      engineVersion: job.engineVersion,
      progress: {
        processedCells: job.processedCells,
        totalCells: job.status === 'completed' ? job.processedCells : null,
      },
      findingCount: job.findingCount,
      sheets: job.sheets,
      coverage: job.coverage ?? 'pending',
      compatibilityFlags: job.compatibilityFlags,
      generationEligible: false,
    };
  }
}
