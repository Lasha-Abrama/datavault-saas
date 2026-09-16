import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';

describe('EmailService', () => {
  it('sends a clear plaintext activation email through the provider-neutral contract', async () => {
    const sender = { send: jest.fn().mockResolvedValue(undefined) };
    const service = new EmailService(
      sender,
      new ConfigService({
        ACCOUNT_ACTIVATION_URL: 'https://app.example.test/auth/activate',
      }),
    );
    await service.sendCompanyActivation(
      'owner@example.com',
      '<Acme>',
      'a'.repeat(43),
    );
    expect(sender.send).toHaveBeenCalledWith({
      to: 'owner@example.com',
      subject: 'Activate your DataVault account',
      text: [
        'Your DataVault company account for <Acme> is ready.',
        '',
        'Activate it within 24 hours:',
        'https://app.example.test/auth/activate?token=' + 'a'.repeat(43),
        '',
        'If you did not register this account, you can ignore this email.',
      ].join('\n'),
    });
  });
});
