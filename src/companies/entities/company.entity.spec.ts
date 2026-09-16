import { companySchema } from './company.entity';
import { userSchema } from '../../users/entities/user.entity';

describe('tenant schema indexes', () => {
  it('enforces case-insensitive unique company names', () => {
    expect(companySchema.indexes()).toContainEqual([
      { name: 1 },
      expect.objectContaining({
        unique: true,
        collation: { locale: 'en', strength: 2 },
      }),
    ]);
  });

  it('requires every user to have a company', () => {
    expect(userSchema.path('companyId').isRequired).toBe(true);
  });

  it('indexes users by company and role', () => {
    expect(userSchema.indexes()).toContainEqual([
      { companyId: 1, role: 1 },
      expect.any(Object),
    ]);
  });
});
