import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

export enum CompanyFileType {
  CSV = 'csv',
  XLS = 'xls',
  XLSX = 'xlsx',
}

@Schema({ timestamps: true })
export class CompanyFile {
  @Prop({
    type: Types.ObjectId,
    ref: 'company',
    required: true,
    immutable: true,
    index: true,
  })
  companyId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
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

  createdAt: Date;
  updatedAt: Date;
}

export const companyFileSchema = SchemaFactory.createForClass(CompanyFile);
companyFileSchema.index({ companyId: 1, createdAt: -1, _id: -1 });
companyFileSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete (ret as unknown as Record<string, unknown>).storageKey;
    return ret;
  },
});
