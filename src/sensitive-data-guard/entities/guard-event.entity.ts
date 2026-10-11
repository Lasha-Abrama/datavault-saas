import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types } from 'mongoose';
@Schema({ strict: 'throw', autoCreate: false, autoIndex: false })
export class GuardEvent {
  @Prop({ type: MongoSchema.Types.ObjectId, required: true, immutable: true })
  companyId: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, required: true, immutable: true })
  jobId: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, required: true, immutable: true })
  actorId: Types.ObjectId;
  @Prop({
    required: true,
    enum: ['queued', 'completed', 'failed', 'cancelled'],
    immutable: true,
  })
  action: string;
  @Prop({ default: Date.now, immutable: true }) createdAt: Date;
}
export const guardEventSchema = SchemaFactory.createForClass(GuardEvent);
guardEventSchema.index({ companyId: 1, jobId: 1, createdAt: 1 });
