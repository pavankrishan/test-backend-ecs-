/**
 * Guarantee: student-auth must NOT write latitude/longitude to student_profiles.
 * student-service is the single source of truth for profile; auth only reads or proxies.
 */
import { upsertStudentProfile } from './student.model';

// Mock getPool so we never hit the DB; we only assert the guard throws.
jest.mock('../config/database', () => ({
  getPool: jest.fn(() => ({ query: jest.fn() })),
}));

describe('student.model profile ownership', () => {
  it('throws when latitude is provided (auth must not write latitude)', async () => {
    await expect(
      upsertStudentProfile('00000000-0000-0000-0000-000000000001', {
        fullName: 'Test',
        latitude: 12.34,
      } as any)
    ).rejects.toThrow(/student-auth must not write latitude/);
  });

  it('throws when longitude is provided (auth must not write longitude)', async () => {
    await expect(
      upsertStudentProfile('00000000-0000-0000-0000-000000000001', {
        fullName: 'Test',
        longitude: 56.78,
      } as any)
    ).rejects.toThrow(/student-auth must not write longitude/);
  });

  it('throws when both latitude and longitude are provided', async () => {
    await expect(
      upsertStudentProfile('00000000-0000-0000-0000-000000000001', {
        fullName: 'Test',
        latitude: 12.34,
        longitude: 56.78,
      } as any)
    ).rejects.toThrow(/student-auth must not write/);
  });
});
