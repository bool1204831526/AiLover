import { describe, expect, it } from 'vitest';

import { DomainError } from './index';

describe('DomainError', () => {
  it('retains a stable code and context', () => {
    const error = new DomainError('character.invalid', 'Invalid character', { field: 'name' });

    expect(error.code).toBe('character.invalid');
    expect(error.context).toEqual({ field: 'name' });
  });
});
