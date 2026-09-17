import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

interface MongoHelloResponse {
  logicalSessionTimeoutMinutes?: number;
  msg?: string;
  setName?: string;
}

@Injectable()
export class MongoTransactionSupportService implements OnApplicationBootstrap {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    if (this.config.getOrThrow<string>('NODE_ENV') === 'test') return;
    if (!this.connection.db) throw this.unsupported();

    let hello: MongoHelloResponse;
    try {
      hello = await this.connection.db.admin().command({ hello: 1 });
    } catch {
      throw new Error('MongoDB transaction capability check failed');
    }
    const supportsSessions =
      typeof hello.logicalSessionTimeoutMinutes === 'number';
    const supportsTransactions =
      Boolean(hello.setName) || hello.msg === 'isdbgrid';
    if (!supportsSessions || !supportsTransactions) throw this.unsupported();
  }

  private unsupported() {
    return new Error(
      'MongoDB must be a replica set or sharded cluster with transaction support',
    );
  }
}
