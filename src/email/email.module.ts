import { Module } from '@nestjs/common';
import { EmailSender } from './email-sender';
import { EmailService } from './email.service';
import { SmtpEmailSender } from './smtp-email.sender';

@Module({
  providers: [
    EmailService,
    { provide: EmailSender, useClass: SmtpEmailSender },
  ],
  exports: [EmailService, EmailSender],
})
export class EmailModule {}
