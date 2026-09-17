import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { Role } from '../../enums/roles.enum';

@Schema({ timestamps: true })
export class User {
  @Prop({ type: String, trim: true, maxlength: 100 })
  fullName?: string;

  @Prop({
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  })
  email: string;

  @Prop({ type: String, select: false })
  password?: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'company',
    required: true,
    immutable: true,
    index: true,
  })
  companyId: Types.ObjectId;

  @Prop({ type: String, enum: Role, default: Role.COMPANY_MEMBER })
  role: Role;

  @Prop({ type: String })
  avatar?: string;
}

export const userSchema = SchemaFactory.createForClass(User);
userSchema.index({ companyId: 1, role: 1 });
userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.password;
    return ret;
  },
});
