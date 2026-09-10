import { describe, expect, it } from 'vitest';

import { SENSITIVE_PATHS } from './index';

describe('logging redaction', () => {
  it('covers credentials and model content', () => {
    expect(SENSITIVE_PATHS).toContain('apiKey');
    expect(SENSITIVE_PATHS).toContain('request.messages');
    expect(SENSITIVE_PATHS).toContain('response.content');
  });
});
