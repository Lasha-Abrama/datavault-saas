import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types } from 'mongoose';
import {
  CATEGORIES,
  Category,
  GuardState,
  SAFE_ERRORS,
  STATES,
} from '../guard.constants';
@Schema({ timestamps: true, strict: 'throw' })
export class GuardJob {
  @Prop({ type: MongoSchema.Types.ObjectId, required: true, immutable: true })
  companyId: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, required: true, immutable: true })
  requestedBy: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, required: true, immutable: true })
  sourceFileId: Types.ObjectId;
  @Prop({ required: true, immutable: true }) requestKey: string;
  @Prop({ required: true, immutable: true, select: false }) fingerprint: string;
  @Prop({ type: [String], enum: CATEGORIES, required: true, immutable: true })
  categories: Category[];
  @Prop({ immutable: true }) phoneRegion?: string;
  @Prop({ enum: STATES, default: 'queued' }) status: GuardState;
  @Prop({ default: true }) active: boolean;
  @Prop({
    enum: [
      'queued',
      'fetching',
      'scanning',
      'completed',
      'failed',
      'cancelled',
    ],
    default: 'queued',
  })
  phase: string;
  @Prop({ default: 0 }) attempts: number;
  @Prop({ select: false }) leaseToken?: string;
  @Prop() leaseExpiresAt?: Date;
  @Prop() startedAt?: Date;
  @Prop() finishedAt?: Date;
  @Prop({ enum: SAFE_ERRORS }) errorCode?: string;
  @Prop({ select: false }) sourceDigest?: string;
  @Prop({ default: 0 }) processedCells: number;
  @Prop({ default: 0 }) findingCount: number;
  @Prop({ default: 0 }) sheets: number;
  @Prop({ type: [String], default: [] }) compatibilityFlags: string[];
  @Prop({ enum: ['supported', 'limited'] }) coverage?: string;
  @Prop({ default: 'ooxml_scan_v1', immutable: true }) engineVersion: string;
  createdAt: Date;
  updatedAt: Date;
}
export const guardJobSchema = SchemaFactory.createForClass(GuardJob);
guardJobSchema.index(
  { companyId: 1, requestedBy: 1, requestKey: 1 },
  { unique: true },
);
// One active scan per tenant also bounds queue admission across API replicas.
guardJobSchema.index(
  { companyId: 1, active: 1 },
  { unique: true, partialFilterExpression: { active: true } },
);
guardJobSchema.index({ status: 1, leaseExpiresAt: 1, createdAt: 1 });
guardJobSchema.index({
  companyId: 1,
  requestedBy: 1,
  sourceFileId: 1,
  _id: -1,
});
