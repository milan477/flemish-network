import { describe, expect, it } from 'vitest';
import { validateStaffPassword } from '../passwordPolicy';

describe('validateStaffPassword', () => {
  it('requires a strong staff password', () => {
    expect(validateStaffPassword('short')).toMatch(/at least 12/);
    expect(validateStaffPassword('lowercase-password1!')).toMatch(/uppercase/);
    expect(validateStaffPassword('UPPERCASE-PASSWORD1!')).toMatch(/lowercase/);
    expect(validateStaffPassword('NoNumberPassword!')).toMatch(/number/);
    expect(validateStaffPassword('NoSymbolPassword1')).toMatch(/symbol/);
    expect(validateStaffPassword('StrongPassword1!')).toBeNull();
  });
});
