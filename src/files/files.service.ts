import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { Connection, Model } from 'mongoose';
import { ObjectStorage } from '../aws-s3/object-storage';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { Role } from '../enums/roles.enum';
import { EntitlementsService } from '../subscriptions/entitlements.service';
import { EntitlementDenialReason } from '../subscriptions/subscription.constants';
import { IsValidMongoDBId } from '../users/dto/is-valid-objectID.dto';
import { QueryParams } from '../users/dto/query-params.dto';
import { CompanyFile } from './entities/company-file.entity';
import { UploadedCompanyFile, validateCompanyFile } from './file-validation';

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    @InjectModel('companyFile')
    private readonly fileModel: Model<CompanyFile>,
    private readonly storage: ObjectStorage,
    private readonly entitlements: EntitlementsService,
    private readonly config: ConfigService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async upload(
    actor: AuthenticatedUser,
    upload: UploadedCompanyFile | undefined,
    now = new Date(),
  ) {
    const file = validateCompanyFile(
      upload,
      this.config.getOrThrow<number>('FILE_MAX_SIZE_BYTES'),
    );
    const availability = await this.entitlements.checkFileUpload(
      actor.companyId,
      1,
      now,
    );
    if (!availability.allowed)
      throw new ForbiddenException({
        message: 'The monthly file upload limit has been reached',
        reason: EntitlementDenialReason.FILE_LIMIT_REACHED,
        limit: availability.includedFilesPerMonth,
      });

    const storageKey = `companies/${actor.companyId}/files/${randomUUID()}.${file.fileType}`;
    await this.storage.putObject({
      key: storageKey,
      body: file.buffer,
      contentType: file.mimeType,
    });

    try {
      const metadata = await this.connection.transaction(
        async (session) => {
          await this.entitlements.recordFileUploads(
            actor.companyId,
            1,
            now,
            session,
          );
          const [created] = await this.fileModel.create(
            [
              {
                companyId: actor.companyId,
                uploaderId: actor.id,
                originalFilename: file.originalFilename,
                storageKey,
                fileType: file.fileType,
                mimeType: file.mimeType,
                size: file.size,
              },
            ],
            { session },
          );
          return created;
        },
        { writeConcern: { w: 'majority' } },
      );
      return this.publicMetadata(metadata);
    } catch (error) {
      if (this.hasUnknownCommitResult(error)) {
        try {
          const committed = await this.fileModel.findOne(
            { companyId: actor.companyId, storageKey },
            null,
            {
              readPreference: 'primary',
              readConcern: { level: 'majority' },
            },
          );
          if (committed) return this.publicMetadata(committed);
        } catch {
          this.logger.error(
            'Could not confirm an uncertain upload transaction',
          );
          throw error;
        }
      }
      try {
        await this.storage.deleteObject(storageKey);
      } catch {
        this.logger.error('Could not clean up an uncommitted storage object');
      }
      throw error;
    }
  }

  async findAll(actor: AuthenticatedUser, { page, take }: QueryParams) {
    take = Math.min(take, 30);
    const filter = { companyId: actor.companyId };
    const [files, total] = await Promise.all([
      this.fileModel
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * take)
        .limit(take),
      this.fileModel.countDocuments(filter),
    ]);
    return {
      files: files.map((file) => this.publicMetadata(file)),
      total,
      page,
      take,
    };
  }

  async findOne(actor: AuthenticatedUser, fileId: string) {
    const file = await this.fileModel.findOne({
      _id: fileId,
      companyId: actor.companyId,
    });
    if (!file) throw new NotFoundException('File not found');
    return this.publicMetadata(file);
  }

  async download(actor: AuthenticatedUser, fileId: string) {
    const file = await this.findStoredFile(actor, fileId);
    const stored = await this.storage.getObject(file.storageKey);
    return { file, ...stored };
  }

  async delete(actor: AuthenticatedUser, fileId: string) {
    const file = await this.findStoredFile(actor, fileId);
    if (
      actor.role !== Role.COMPANY_OWNER &&
      file.uploaderId.toString() !== actor.id
    )
      throw new ForbiddenException(
        'Only the uploader or company owner can delete this file',
      );

    await this.storage.deleteObject(file.storageKey);
    const deleted = await this.fileModel.findOneAndDelete({
      _id: fileId,
      companyId: actor.companyId,
      storageKey: file.storageKey,
    });
    if (!deleted) throw new NotFoundException('File not found');
    return { message: 'File deleted.' };
  }

  private async findStoredFile(
    actor: AuthenticatedUser,
    fileId: IsValidMongoDBId['id'],
  ) {
    const file = await this.fileModel
      .findOne({ _id: fileId, companyId: actor.companyId })
      .select('+storageKey');
    if (!file) throw new NotFoundException('File not found');
    return file;
  }

  private publicMetadata(file: CompanyFile & { _id?: unknown }) {
    return {
      id: file._id,
      uploaderId: file.uploaderId,
      originalFilename: file.originalFilename,
      fileType: file.fileType,
      mimeType: file.mimeType,
      size: file.size,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    };
  }

  private hasUnknownCommitResult(error: unknown) {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('errorLabels' in error)
    )
      return false;
    return (
      Array.isArray(error.errorLabels) &&
      error.errorLabels.includes('UnknownTransactionCommitResult')
    );
  }
}
