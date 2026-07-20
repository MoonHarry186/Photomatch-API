import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../database/prisma.service';
import { MessagingService } from './messaging.service';

interface SocketClaims {
  sub: string;
  sid: string;
  typ: 'access';
}

type AuthenticatedSocket = Socket & { data: { userId?: string } };

@WebSocketGateway({ namespace: '/realtime', cors: { origin: true, credentials: true } })
export class MessagingGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
  ) {}

  async handleConnection(socket: AuthenticatedSocket): Promise<void> {
    const token = this.token(socket);
    if (!token) {
      socket.disconnect(true);
      return;
    }
    try {
      const claims = await this.jwt.verifyAsync<SocketClaims>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
      const session = await this.prisma.authSession.findFirst({
        where: {
          id: claims.sid,
          userId: claims.sub,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (!session || claims.typ !== 'access') {
        socket.disconnect(true);
        return;
      }
      socket.data.userId = claims.sub;
      await socket.join(`user:${claims.sub}`);
    } catch {
      socket.disconnect(true);
    }
  }

  @SubscribeMessage('conversation.join')
  async join(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { conversationId?: string },
  ): Promise<{ conversationId: string; joined: true }> {
    const userId = socket.data.userId;
    const conversationId = payload.conversationId;
    if (!userId || !conversationId || !(await this.messaging.canJoin(userId, conversationId))) {
      throw new WsException('CONVERSATION_ACCESS_DENIED');
    }
    await socket.join(`conversation:${conversationId}`);
    return { conversationId, joined: true };
  }

  publishToConversation(conversationId: string, event: string, payload: unknown): void {
    this.server.to(`conversation:${conversationId}`).emit(event, payload);
  }

  publishToUsers(userIds: string[], event: string, payload: unknown): void {
    for (const userId of userIds) this.server.to(`user:${userId}`).emit(event, payload);
  }

  private token(socket: Socket): string | undefined {
    const authToken = socket.handshake.auth?.token;
    if (typeof authToken === 'string') return authToken.replace(/^Bearer\s+/i, '');
    const header = socket.handshake.headers.authorization;
    return typeof header === 'string' ? header.replace(/^Bearer\s+/i, '') : undefined;
  }
}
