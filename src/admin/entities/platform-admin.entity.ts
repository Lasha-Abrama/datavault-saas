import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ timestamps: true })
export class PlatformAdmin {
  @Prop({
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  })
  email: string;

  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 100,
  })
  fullName: string;

  @Prop({ type: String, required: true, select: false })
  password: string;

  @Prop({ type: Boolean, default: true, required: true })
  isActive: boolean;

  createdAt: Date;
}

export const platformAdminSchema = SchemaFactory.createForClass(PlatformAdmin);
platformAdminSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete (ret as unknown as Record<string, unknown>).password;
    return ret;
  },
});
