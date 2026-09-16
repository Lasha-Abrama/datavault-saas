import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { isISO31661Alpha2 } from 'class-validator';

@Schema({ timestamps: true })
export class Company {
  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 100,
  })
  name: string;

  @Prop({
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    minlength: 2,
    maxlength: 2,
    match: /^[A-Z]{2}$/,
    validate: { validator: isISO31661Alpha2, message: 'Invalid country code' },
  })
  country: string;

  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 100,
    set: (value: string) => value.trim().replace(/\s+/g, ' '),
  })
  industry: string;

  @Prop({ type: Date, default: null })
  activatedAt: Date | null;
}

export const companySchema = SchemaFactory.createForClass(Company);
companySchema.index(
  { name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } },
);
