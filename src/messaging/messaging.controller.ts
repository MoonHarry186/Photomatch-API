import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/auth-context';
import type { AuthenticatedUser } from '../common/auth-context';
import { CursorPageDto } from '../common/pagination';
import { MessagingService } from './messaging.service';
import { ReceiptDto, SendMessageDto } from './messaging.dto';

@ApiTags('messaging')
@ApiBearerAuth()
@Controller('conversations')
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get()
  conversations(@CurrentUser() user: AuthenticatedUser, @Query() query: CursorPageDto) {
    return this.messaging.conversations(user.userId, query);
  }

  @Get(':conversationId')
  conversation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ) {
    return this.messaging.conversation(user.userId, conversationId);
  }

  @Get(':conversationId/messages')
  messages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Query() query: CursorPageDto,
  ) {
    return this.messaging.messages(user.userId, conversationId, query);
  }

  @Post(':conversationId/messages')
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.messaging.send(user.userId, conversationId, dto);
  }

  @Put(':conversationId/messages/:messageId/receipt')
  receipt(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: ReceiptDto,
  ) {
    return this.messaging.receipt(user.userId, conversationId, messageId, dto);
  }
}
