import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types } from 'mongoose';
import { CATEGORIES, Category } from '../guard.constants';
@Schema({ strict: 'throw', autoCreate: false, autoIndex: false })
export class GuardFinding {
  @Prop({ type: MongoSchema.Types.ObjectId, required: true, immutable: true })
  companyId: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, required: true, immutable: true })
  jobId: Types.ObjectId;
  @Prop({ required: true, min: 0 }) ordinal: number;
  @Prop({ required: true, min: 0 }) sheetIndex: number;
  @Prop({ required: true, min: 1 }) row: number;
  @Prop({ required: true, min: 1 }) column: number;
  @Prop({ required: true, enum: CATEGORIES }) category: Category;
  @Prop({ required: true, enum: ['format_valid', 'checksum_valid'] })
  evidence: string;
  @Prop({ required: true }) hidden: boolean;
}
export const guardFindingSchema = SchemaFactory.createForClass(GuardFinding);
guardFindingSchema.index(
  { companyId: 1, jobId: 1, ordinal: 1 },
  { unique: true },
);
