import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateBy,
} from 'class-validator';

export class AiChatDto {
  @IsOptional()
  @IsMongoId()
  conversationId?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(50_000)
  @ValidateBy({
    name: 'nonWhitespaceMessage',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' && value.trim().length > 0,
    },
  })
  message: string;
}

export class AiConversationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}

export class AiConversationIdDto {
  @IsMongoId()
  id: string;
}

export class AiEmptyDto {}
