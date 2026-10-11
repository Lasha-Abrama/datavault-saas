import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { User } from '../users/entities/user.entity';
import { Company } from '../companies/entities/company.entity';
import { CompanyPlatformStatus } from '../companies/platform-status';
import { Role } from '../enums/roles.enum';
import { FilesService } from '../files/files.service';
import { AuthenticatedUser } from '../common/types/authenticated-user';
@Injectable()
export class GuardAccessService {
  constructor(
    @InjectModel('user') private readonly users: Model<User>,
    @InjectModel('company') private readonly companies: Model<Company>,
    private readonly files: FilesService,
  ) {}
  async resolve(
    userId: string,
    companyId: string,
    fileId: string,
    session?: ClientSession,
  ): Promise<AuthenticatedUser> {
    const userFilter = {
      _id: userId,
      companyId,
      role: { $in: Object.values(Role) },
    };
    const companyFilter = {
      _id: companyId,
      activatedAt: { $ne: null },
      platformStatus: { $ne: CompanyPlatformStatus.SUSPENDED },
    };
    const user = session
      ? await this.users.findOneAndUpdate(
          userFilter,
          { $inc: { guardScanFence: 1 } },
          { session, new: true, timestamps: false },
        )
      : await this.users.findOne(userFilter);
    const company = session
      ? await this.companies.findOneAndUpdate(
          companyFilter,
          { $inc: { guardScanFence: 1 } },
          { session, new: true, timestamps: false },
        )
      : await this.companies.findOne(companyFilter);
    if (!user || !company) throw new NotFoundException('Scan not found');
    const actor = { id: userId, companyId, role: user.role };
    await this.files.processingSource(actor, fileId, session);
    return actor;
  }
}
