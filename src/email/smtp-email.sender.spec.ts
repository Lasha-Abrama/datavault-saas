import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { SmtpEmailSender } from './smtp-email.sender';

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn() },
}));

describe('SmtpEmailSender', () => {
  it('configures bounded timeouts and TLS and sends without logging credentials', async () => {
    const sendMail = jest.fn().mockResolvedValue(undefined);
    const createTransport = jest.mocked(nodemailer.createTransport);
    createTransport.mockReturnValue({ sendMail } as never);
    const sender = new SmtpEmailSender(
      new ConfigService({
        SMTP_HOST: 'smtp.example.test',
        SMTP_PORT: 587,
        SMTP_SECURE: false,
        SMTP_REQUIRE_TLS: true,
        SMTP_FROM: 'no-reply@example.com',
        SMTP_USER: 'user',
        SMTP_PASSWORD: 'secret',
      }),
    );
    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.test',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'user', pass: 'secret' },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    await sender.send({
      to: 'owner@example.com',
      subject: 'Activation',
      text: 'Link',
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'no-reply@example.com',
      to: 'owner@example.com',
      subject: 'Activation',
      text: 'Link',
    });
  });
});
