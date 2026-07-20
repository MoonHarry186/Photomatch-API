import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class SendMessageDto {
  @ApiProperty()
  @IsString()
  @MaxLength(120)
  clientMessageId!: string;

  @ApiProperty({ enum: [MessageType.TEXT, MessageType.IMAGE, MessageType.FILE] })
  @IsEnum(MessageType)
  messageType!: MessageType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  content?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assetId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  replyToMessageId?: string;
}

export class ReceiptDto {
  @ApiProperty({ enum: ['delivered', 'read'] })
  @IsString()
  type!: 'delivered' | 'read';
}
