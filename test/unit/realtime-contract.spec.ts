import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../../src/database/prisma.service';
import { EventSubscriberService } from '../../src/jobs/event-subscriber.service';
import { MessagingGateway } from '../../src/messaging/messaging.gateway';
import { MessagingService } from '../../src/messaging/messaging.service';

interface TestSocket {
  handshake: { auth: Record<string, string>; headers: Record<string, string> };
  data: { userId?: string };
  join: jest.Mock;
  disconnect: jest.Mock;
}

interface SubscriberHarness {
  publish(message: string): void;
}

describe('realtime contracts', () => {
  const jwt = { verifyAsync: jest.fn() };
  const config = { getOrThrow: jest.fn(() => 'test-secret') };
  const prisma = { authSession: { findFirst: jest.fn() } };
  const messaging = { canJoin: jest.fn() };
  let gateway: MessagingGateway;

  beforeEach(() => {
    jest.clearAllMocks();
    gateway = new MessagingGateway(
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
      prisma as unknown as PrismaService,
      messaging as unknown as MessagingService,
    );
  });

  it('authenticates sockets, joins user rooms, and denies unauthorized conversation rooms', async () => {
    const socket = testSocket('access-token');
    jwt.verifyAsync.mockResolvedValue({ sub: 'user-1', sid: 'session-1', typ: 'access' });
    prisma.authSession.findFirst.mockResolvedValue({ id: 'session-1' });
    await gateway.handleConnection(socket as unknown as Socket);
    expect(socket.data.userId).toBe('user-1');
    expect(socket.join).toHaveBeenCalledWith('user:user-1');

    messaging.canJoin.mockResolvedValueOnce(false);
    await expect(
      gateway.join(socket as unknown as Socket, { conversationId: 'conversation-1' }),
    ).rejects.toThrow('CONVERSATION_ACCESS_DENIED');
    messaging.canJoin.mockResolvedValueOnce(true);
    await expect(
      gateway.join(socket as unknown as Socket, { conversationId: 'conversation-1' }),
    ).resolves.toEqual({ conversationId: 'conversation-1', joined: true });
    expect(socket.join).toHaveBeenCalledWith('conversation:conversation-1');
  });

  it('disconnects sockets without a valid access session', async () => {
    const missing = testSocket();
    await gateway.handleConnection(missing as unknown as Socket);
    expect(missing.disconnect).toHaveBeenCalledWith(true);

    const invalid = testSocket('invalid');
    jwt.verifyAsync.mockRejectedValue(new Error('invalid token'));
    await gateway.handleConnection(invalid as unknown as Socket);
    expect(invalid.disconnect).toHaveBeenCalledWith(true);
  });

  it('publishes directly to the requested Socket.IO rooms', () => {
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    gateway.server = { to } as unknown as Server;
    gateway.publishToConversation('conversation-1', 'conversation.message.created', {
      messageId: 'message-1',
    });
    gateway.publishToUsers(['user-1', 'user-2'], 'match.created', { matchId: 'match-1' });
    expect(to).toHaveBeenCalledWith('conversation:conversation-1');
    expect(to).toHaveBeenCalledWith('user:user-1');
    expect(to).toHaveBeenCalledWith('user:user-2');
    expect(emit).toHaveBeenCalledWith(
      'conversation.message.created',
      expect.objectContaining({ messageId: 'message-1' }),
    );
  });

  it.each([
    ['conversation.message.created', { conversationId: 'conversation-1', messageId: 'message-1' }],
    ['message.read', { conversationId: 'conversation-1', messageId: 'message-1' }],
    ['match.created', { matchId: 'match-1', userIds: ['user-1', 'user-2'] }],
    [
      'booking.created',
      { bookingId: 'booking-1', conversationId: 'conversation-1', recipientUserId: 'user-2' },
    ],
    [
      'booking.status_changed',
      { bookingId: 'booking-1', conversationId: 'conversation-1', recipientUserId: 'user-1' },
    ],
  ])('routes %s to authorized room targets', (eventType, payload) => {
    const realtime = {
      publishToConversation: jest.fn(),
      publishToUsers: jest.fn(),
    };
    const subscriber = new EventSubscriberService(
      { getOrThrow: () => 'redis://127.0.0.1:56379' } as unknown as ConfigService,
      realtime as unknown as MessagingGateway,
    );
    (subscriber as unknown as SubscriberHarness).publish(JSON.stringify({ eventType, payload }));
    if ('conversationId' in payload) {
      expect(realtime.publishToConversation).toHaveBeenCalledWith(
        payload.conversationId,
        eventType,
        payload,
      );
    }
    const recipients = [
      ...('userIds' in payload ? payload.userIds : []),
      ...('recipientUserId' in payload ? [payload.recipientUserId] : []),
    ];
    if (recipients.length) {
      expect(realtime.publishToUsers).toHaveBeenCalledWith(recipients, eventType, payload);
    }
    subscriber.onModuleDestroy();
  });
});

function testSocket(token?: string): TestSocket {
  return {
    handshake: { auth: token ? { token } : {}, headers: {} },
    data: {},
    join: jest.fn(),
    disconnect: jest.fn(),
  };
}
