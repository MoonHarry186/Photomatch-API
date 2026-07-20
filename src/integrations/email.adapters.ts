import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { EmailMessage, EmailPort } from './integration.ports';

@Injectable()
export class FakeEmailAdapter implements EmailPort {
  private readonly logger = new Logger(FakeEmailAdapter.name);
  private readonly deliveries: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.deliveries.push(message);
    this.logger.log(
      JSON.stringify({ event: 'email.accepted', recipient: message.to, subject: message.subject }),
    );
  }

  drain(): EmailMessage[] {
    return this.deliveries.splice(0);
  }
}

@Injectable()
export class SmtpEmailAdapter implements EmailPort {
  private readonly transport;
  private readonly from: string;

  constructor(config: ConfigService) {
    this.transport = nodemailer.createTransport(
      config.get<string>('SMTP_URL', 'smtp://127.0.0.1:1025'),
    );
    this.from = config.getOrThrow<string>('EMAIL_FROM');
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
  }
}
