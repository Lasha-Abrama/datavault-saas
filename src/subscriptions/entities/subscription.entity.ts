import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { PlanCode } from '../../plans/plan.constants';

@Schema({ timestamps: true })
export class Subscription {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'company',
    required: true,
    unique: true,
    immutable: true,
  })
  companyId: Types.ObjectId;

  @Prop({
    type: String,
    enum: PlanCode,
    required: true,
    default: PlanCode.FREE,
  })
  planCode: PlanCode;

  @Prop({ type: Date, required: true, immutable: true })
  activatedAt: Date;

  @Prop({ type: Date, required: true })
  planChangedAt: Date;

  // Serializes plan changes, member additions, and usage recording in transactions.
  @Prop({ type: Number, required: true, default: 0, min: 0 })
  revision: number;
}

export const subscriptionSchema = SchemaFactory.createForClass(Subscription);
