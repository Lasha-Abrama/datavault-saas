import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';

export enum CompanyFileType {
  CSV = 'csv',
  XLS = 'xls',
  XLSX = 'xlsx',
}

export enum CompanyFileVisibility {
  COMPANY_WIDE = 'company_wide',
  RESTRICTED = 'restricted',
}

@Schema({ _id: false })
export class FileDerivation {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    immutable: true,
  })
  sourceFileId: Types.ObjectId;
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    immutable: true,
  })
  jobId: Types.ObjectId;
  @Prop({ required: true, immutable: true }) strategyVersion: string;
  @Prop({ required: true, immutable: true }) createdAt: Date;
}
const derivationSchema = SchemaFactory.createForClass(FileDerivation);
@Schema({ timestamps: true })
export class CompanyFile {
  @Prop({ type: derivationSchema, immutable: true })
  derivation?: FileDerivation;
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'company',
    required: true,
    immutable: true,
    index: true,
  })
  companyId: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'user',
    required: true,
    immutable: true,
  })
  uploaderId: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, maxlength: 255 })
  originalFilename: string;

  @Prop({
    type: String,
    required: true,
    immutable: true,
    unique: true,
    select: false,
    maxlength: 500,
  })
  storageKey: string;

  @Prop({
    type: String,
    required: true,
    enum: CompanyFileType,
    immutable: true,
  })
  fileType: CompanyFileType;

  @Prop({ type: String, required: true, immutable: true })
  mimeType: string;

  @Prop({ type: Number, required: true, immutable: true, min: 1 })
  size: number;

  @Prop({
    type: String,
    required: true,
    enum: CompanyFileVisibility,
    default: CompanyFileVisibility.COMPANY_WIDE,
  })
  visibility: CompanyFileVisibility;

  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: 'user' }],
    default: [],
  })
  restrictedUserIds: Types.ObjectId[];

  // A publication transaction writes this fence to conflict with revocation/deletion.
  @Prop({ type: Number, default: 0, select: false })
  guardScanFence: number;

  createdAt: Date;
  updatedAt: Date;
}

export const companyFileSchema = SchemaFactory.createForClass(CompanyFile);
companyFileSchema.index({ createdAt: -1, _id: -1 });
companyFileSchema.index({ companyId: 1, createdAt: -1, _id: -1 });
companyFileSchema.index({
  companyId: 1,
  visibility: 1,
  createdAt: -1,
  _id: -1,
});
companyFileSchema.index({
  companyId: 1,
  restrictedUserIds: 1,
  createdAt: -1,
  _id: -1,
});
companyFileSchema.pre('validate', function () {
  const restrictedUserIds = this.restrictedUserIds ?? [];
  if (
    this.visibility === CompanyFileVisibility.COMPANY_WIDE &&
    restrictedUserIds.length > 0
  )
    this.invalidate(
      'restrictedUserIds',
      'Company-wide files cannot have restricted employees',
    );
  if (
    this.visibility === CompanyFileVisibility.RESTRICTED &&
    restrictedUserIds.length === 0
  )
    this.invalidate(
      'restrictedUserIds',
      'Restricted files require at least one employee',
    );
  if (
    new Set(restrictedUserIds.map((userId) => userId.toString())).size !==
    restrictedUserIds.length
  )
    this.invalidate('restrictedUserIds', 'Restricted employees must be unique');
});
companyFileSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete (ret as unknown as Record<string, unknown>).guardScanFence;
    delete (ret as unknown as Record<string, unknown>).storageKey;
    return ret;
  },
});
