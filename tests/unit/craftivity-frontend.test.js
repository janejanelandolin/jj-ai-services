/**
 * Unit tests for frontend helper logic extracted from the automate-socials app.
 * Tests pure JS functions without a DOM or browser.
 */

// ── Helpers copied from the app (pure functions worth unit-testing) ─────────

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function buildBrandProfile(fields) {
  return {
    client_id:        fields.clientId,
    biz_name:         (fields.bizName        || '').trim(),
    ig_handle:        (fields.igHandle        || '').trim(),
    biz_location:     (fields.bizLocation     || '').trim(),
    biz_audience:     (fields.bizAudience     || '').trim(),
    brand_voice:      (fields.brandVoice      || '').trim(),
    class_types:      (fields.classTypes      || '').trim(),
    price_range:      (fields.priceRange      || '').trim(),
    booking_link:     (fields.bookingLink     || '').trim(),
    default_hashtags: (fields.defaultHashtags || '').trim(),
    updated_at:       new Date().toISOString(),
  };
}

function validatePostBeforeSave({ caption }) {
  if (!caption || !caption.trim()) return 'Caption cannot be empty';
  return null;
}

// ── escHtml ────────────────────────────────────────────────────────────────

describe('escHtml', () => {
  test('escapes ampersands', () => {
    expect(escHtml('cats & dogs')).toBe('cats &amp; dogs');
  });

  test('escapes less-than and greater-than', () => {
    expect(escHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('escapes double quotes', () => {
    expect(escHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  test('handles null gracefully', () => {
    expect(escHtml(null)).toBe('');
  });

  test('handles undefined gracefully', () => {
    expect(escHtml(undefined)).toBe('');
  });

  test('leaves safe strings unchanged', () => {
    expect(escHtml('Hello, world!')).toBe('Hello, world!');
  });
});

// ── fmtDate ────────────────────────────────────────────────────────────────

describe('fmtDate', () => {
  test('returns a non-empty string for a valid ISO date', () => {
    const result = fmtDate('2026-06-15T14:00:00Z');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('includes the month abbreviation', () => {
    const result = fmtDate('2026-06-15T14:00:00Z');
    expect(result).toMatch(/Jun/);
  });

  test('includes the day', () => {
    const result = fmtDate('2026-06-15T14:00:00Z');
    expect(result).toMatch(/15/);
  });
});

// ── buildBrandProfile ──────────────────────────────────────────────────────

describe('buildBrandProfile', () => {
  const baseFields = {
    clientId: 'uuid-abc',
    bizName: '  Craftivity  ',
    igHandle: '@craftivitysf',
    bizLocation: 'San Francisco, CA',
    bizAudience: 'craft lovers',
    brandVoice: 'warm',
    classTypes: 'watercolor, macramé',
    priceRange: '$45–$85',
    bookingLink: 'https://craftivity.com/book',
    defaultHashtags: '#craftivity',
  };

  test('trims whitespace from biz_name', () => {
    const profile = buildBrandProfile(baseFields);
    expect(profile.biz_name).toBe('Craftivity');
  });

  test('sets client_id correctly', () => {
    const profile = buildBrandProfile(baseFields);
    expect(profile.client_id).toBe('uuid-abc');
  });

  test('includes updated_at as a valid ISO string', () => {
    const profile = buildBrandProfile(baseFields);
    expect(() => new Date(profile.updated_at)).not.toThrow();
    expect(new Date(profile.updated_at).getFullYear()).toBeGreaterThanOrEqual(2026);
  });

  test('handles missing optional fields gracefully', () => {
    const profile = buildBrandProfile({ clientId: 'uuid-xyz' });
    expect(profile.biz_name).toBe('');
    expect(profile.booking_link).toBe('');
    expect(profile.default_hashtags).toBe('');
  });
});

// ── validatePostBeforeSave ─────────────────────────────────────────────────

describe('validatePostBeforeSave', () => {
  test('returns null for a valid caption', () => {
    expect(validatePostBeforeSave({ caption: 'Great post!' })).toBeNull();
  });

  test('returns error message for empty caption', () => {
    expect(validatePostBeforeSave({ caption: '' })).toBe('Caption cannot be empty');
  });

  test('returns error message for whitespace-only caption', () => {
    expect(validatePostBeforeSave({ caption: '   ' })).toBe('Caption cannot be empty');
  });

  test('returns error message for null caption', () => {
    expect(validatePostBeforeSave({ caption: null })).toBe('Caption cannot be empty');
  });
});
