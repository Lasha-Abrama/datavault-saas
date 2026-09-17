import { model, Types } from 'mongoose';
import { companyFileSchema } from './company-file.entity';

describe('CompanyFile schema', () => {
  it('keeps ownership and storage identity immutable and private', () => {
    expect(companyFileSchema.path('companyId').options.immutable).toBe(true);
    expect(companyFileSchema.path('uploaderId').options.immutable).toBe(true);
    expect(companyFileSchema.path('storageKey').options).toMatchObject({
      immutable: true,
      unique: true,
      select: false,
    });
    const FileModel = model('CompanyFileSchemaTest', companyFileSchema);
    const document = new FileModel({
      companyId: new Types.ObjectId(),
      uploaderId: new Types.ObjectId(),
      originalFilename: 'data.csv',
      storageKey: 'private-key',
      fileType: 'csv',
      mimeType: 'text/csv',
      size: 10,
    });
    expect(document.toJSON()).not.toHaveProperty('storageKey');
  });

  it('indexes tenant pagination without exposing raw contents', () => {
    expect(companyFileSchema.indexes()).toEqual(
      expect.arrayContaining([
        [{ companyId: 1, createdAt: -1, _id: -1 }, expect.any(Object)],
      ]),
    );
    expect(companyFileSchema.path('buffer')).toBeUndefined();
  });
});
