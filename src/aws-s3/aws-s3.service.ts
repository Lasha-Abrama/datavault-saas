import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface UploadFile {
  buffer: Buffer;
  mimetype: string;
}

@Injectable()
export class AwsS3Service {
  private readonly storageService: S3Client;
  private readonly bucketName?: string;
  private readonly logger = new Logger(AwsS3Service.name);

  constructor(private readonly config: ConfigService) {
    this.bucketName = config.get<string>('AWS_BUCKET_NAME');
    const accessKeyId = config.get<string>('AWS_ACCESS_KEY_ID');
    this.storageService = new S3Client({
      region: config.get<string>('AWS_REGION'),
      // Use IAM roles/default credential chain when no explicit credentials are supplied.
      ...(accessKeyId
        ? {
            credentials: {
              accessKeyId,
              secretAccessKey: config.getOrThrow<string>(
                'AWS_SECRET_ACCESS_KEY',
              ),
              sessionToken:
                config.get<string>('AWS_SESSION_TOKEN') || undefined,
            },
          }
        : {}),
    });
  }

  async uploadImage(filePath: string, file: UploadFile) {
    if (!filePath || !file?.buffer || !file.mimetype)
      throw new BadRequestException('File is required');
    this.requireStorage();
    try {
      await this.storageService.send(
        new PutObjectCommand({
          Key: filePath,
          Bucket: this.bucketName,
          Body: file.buffer,
          ContentType: file.mimetype,
        }),
      );
      return filePath;
    } catch {
      this.logger.error('S3 upload failed');
      throw new ServiceUnavailableException('Could not upload file');
    }
  }

  getFile(filePath: string) {
    if (!filePath) throw new BadRequestException('File path is required');
    const baseUrl = this.config.get<string>('CLOUD_FRONT_URL');
    if (!baseUrl)
      throw new ServiceUnavailableException('CloudFront URL is not configured');
    return `${baseUrl.replace(/\/$/, '')}/${filePath.split('/').map(encodeURIComponent).join('/')}`;
  }

  async deleteImg(filePath: string) {
    if (!filePath) throw new BadRequestException('File path is required');
    this.requireStorage();
    await this.storageService.send(
      new DeleteObjectCommand({ Bucket: this.bucketName, Key: filePath }),
    );
    return 'deleted successfully';
  }

  private requireStorage() {
    if (!this.bucketName)
      throw new ServiceUnavailableException('S3 storage is not configured');
  }
}
