import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Role } from '../../enums/roles.enum';

@Schema({ timestamps: true })
export class User {
  @Prop({ type: String })
  fullName: string;

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

  @Prop({ type: String, enum: Role, default: Role.STUDENT })
  role: Role;

  @Prop({ type: String })
  avatar?: string;
}

export const userSchema = SchemaFactory.createForClass(User);
// select:false protects reads; transforms also protect newly saved documents.
userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.password;
    return ret;
  },
});
