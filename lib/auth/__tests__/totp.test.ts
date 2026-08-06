import { describe, expect, it } from 'vitest';

import {
  base32Decode,
  base32Encode,
  generateTotp,
  generateTotpSecret,
  secondsUntilNextStep,
  timeStep,
  totpUri,
  verifyTotp,
} from '../totp';

/* ============================================================================
 * TOTP — proven against RFC 6238's own test vectors
 * ----------------------------------------------------------------------------
 * This is the whole reason TOTP is hand-written here rather than pulled from a
 * package (see the note at the top of totp.ts). The specification publishes
 * known-answer vectors, so the implementation can be shown correct against the
 * standard itself instead of trusted because a library is popular.
 *
 * RFC 6238 Appendix B uses the ASCII seed "12345678901234567890" — 20 bytes,
 * which is exactly the 160-bit secret this module generates. Base32-encoded
 * that is GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ.
 *
 * The published vectors are 8 digits; this module issues 6, which is what
 * authenticator apps display. Both are checked below — the 8-digit ones tie the
 * implementation to the RFC, and the 6-digit ones are the truncation actually
 * shipped, taken from the same digests.
 * ========================================================================= */

/** ASCII "12345678901234567890" in base32, per RFC 6238 Appendix B. */
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

describe('base32 — RFC 4648', () => {
  it('encodes the RFC 6238 seed to the expected string', () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('round-trips arbitrary bytes', () => {
    for (const sample of ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar']) {
      const buffer = Buffer.from(sample, 'ascii');
      expect(base32Decode(base32Encode(buffer)).equals(buffer)).toBe(true);
    }
  });

  it('tolerates the spacing and padding authenticator apps display', () => {
    const spaced = 'GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ';
    expect(base32Decode(spaced).toString('ascii')).toBe('12345678901234567890');
    expect(base32Decode('MZXW6===').toString('ascii')).toBe('foo');
  });

  it('rejects a character outside the alphabet', () => {
    // '1', '0', '8' and '9' are not in the RFC 4648 base32 alphabet.
    expect(() => base32Decode('ABC1')).toThrow(/Invalid base32/);
  });
});

describe('time steps — RFC 6238 §4.2', () => {
  // The table in Appendix B maps these instants to these counter values.
  it.each([
    [59, 0x1],
    [1_111_111_109, 0x23523ec],
    [1_111_111_111, 0x23523ed],
    [1_234_567_890, 0x273ef07],
    [2_000_000_000, 0x3f940aa],
  ])('unix %i → step %i', (seconds, expected) => {
    expect(timeStep(seconds * 1000)).toBe(expected);
  });
});

/* ==========================================================================
 * The known-answer vectors
 * ==========================================================================
 * RFC 6238 Appendix B, the SHA-1 rows. If these pass, the HMAC, the big-endian
 * counter and the dynamic truncation are all correct.
 */

describe('RFC 6238 Appendix B — SHA-1 known-answer vectors', () => {
  const VECTORS: ReadonlyArray<[number, string, string]> = [
    // unix seconds, 8-digit expected, 6-digit expected (same digest, truncated)
    [59, '94287082', '287082'],
    [1_111_111_109, '07081804', '081804'],
    [1_111_111_111, '14050471', '050471'],
    [1_234_567_890, '89005924', '005924'],
    [2_000_000_000, '69279037', '279037'],
    [20_000_000_000, '65353130', '353130'],
  ];

  it.each(VECTORS)('at unix %i the 8-digit code is %s', (seconds, eight) => {
    expect(generateTotp(RFC_SECRET, seconds * 1000, { digits: 8 })).toBe(eight);
  });

  it.each(VECTORS)('at unix %i the 6-digit code is %s', (seconds, _eight, six) => {
    expect(generateTotp(RFC_SECRET, seconds * 1000)).toBe(six);
  });

  it('verifies its own published codes', () => {
    for (const [seconds, , six] of VECTORS) {
      expect(verifyTotp(RFC_SECRET, six, seconds * 1000)).toBe(true);
    }
  });
});

/* ==========================================================================
 * The verification window
 * ========================================================================== */

describe('the ±1 step window — RFC 6238 §5.2', () => {
  const NOW = 1_700_000_000_000; // a round instant, mid-step
  const code = (offsetSteps: number) => generateTotp(RFC_SECRET, NOW + offsetSteps * 30_000);

  it('accepts the current code', () => {
    expect(verifyTotp(RFC_SECRET, code(0), NOW)).toBe(true);
  });

  it('accepts the previous and next code, for clock drift', () => {
    expect(verifyTotp(RFC_SECRET, code(-1), NOW)).toBe(true);
    expect(verifyTotp(RFC_SECRET, code(1), NOW)).toBe(true);
  });

  it('refuses two steps away — a wider window keeps stolen codes alive longer', () => {
    expect(verifyTotp(RFC_SECRET, code(-2), NOW)).toBe(false);
    expect(verifyTotp(RFC_SECRET, code(2), NOW)).toBe(false);
  });

  it('honours a narrowed window', () => {
    expect(verifyTotp(RFC_SECRET, code(-1), NOW, { window: 0 })).toBe(false);
    expect(verifyTotp(RFC_SECRET, code(0), NOW, { window: 0 })).toBe(true);
  });
});

describe('rejecting bad input', () => {
  const NOW = 1_700_000_000_000;

  it.each(['', '12345', '1234567', 'abcdef', '12 34 56 78', '000000x'])(
    'refuses %j',
    (submitted) => {
      expect(verifyTotp(RFC_SECRET, submitted, NOW)).toBe(false);
    },
  );

  it('tolerates spaces inside an otherwise valid code', () => {
    const valid = generateTotp(RFC_SECRET, NOW);
    const spaced = `${valid.slice(0, 3)} ${valid.slice(3)}`;
    expect(verifyTotp(RFC_SECRET, spaced, NOW)).toBe(true);
  });

  it('refuses rather than throwing on a malformed secret', () => {
    expect(verifyTotp('not!base32', '123456', NOW)).toBe(false);
  });

  it('does not go looking at negative counters near the epoch', () => {
    expect(() => verifyTotp(RFC_SECRET, '123456', 0)).not.toThrow();
  });
});

describe('secrets and enrolment', () => {
  it('generates a 160-bit secret — RFC 4226 §4 recommends exactly this', () => {
    const secret = generateTotpSecret();
    expect(base32Decode(secret)).toHaveLength(20);
    expect(secret).toMatch(/^[A-Z2-7]+$/);
  });

  it('never repeats a secret', () => {
    const secrets = new Set(Array.from({ length: 200 }, () => generateTotpSecret()));
    expect(secrets.size).toBe(200);
  });

  it('builds an otpauth URI every authenticator app can read', () => {
    const uri = totpUri({
      secret: RFC_SECRET,
      accountName: 'sana@cni.test',
      issuer: 'CNI CRM',
    });

    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    // The issuer appears in the label AND as a parameter — older apps read only
    // one or the other, and getting it wrong leaves the entry unlabelled.
    expect(uri).toContain('CNI%20CRM%3Asana%40cni.test');
    expect(uri).toContain('issuer=CNI+CRM');
    expect(uri).toContain(`secret=${RFC_SECRET}`);
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});

describe('the enrolment countdown', () => {
  it('counts down within a step and never returns 0', () => {
    // 0 would render as "expires in 0 seconds" for a code that is still valid.
    expect(secondsUntilNextStep(0)).toBe(30);
    expect(secondsUntilNextStep(1_000)).toBe(29);
    expect(secondsUntilNextStep(29_000)).toBe(1);
    expect(secondsUntilNextStep(30_000)).toBe(30);
  });
});

describe('doc 20 §5 — determinism', () => {
  it('gives the same code for the same instant, every time', () => {
    const NOW = 1_700_000_000_000;
    const first = generateTotp(RFC_SECRET, NOW);
    for (let i = 0; i < 50; i += 1) {
      expect(generateTotp(RFC_SECRET, NOW)).toBe(first);
    }
  });

  it('changes code every 30 seconds and not before', () => {
    // 1_700_000_010 is exactly divisible by 30, so this instant sits ON a step
    // boundary — the step runs to +30s, not +20s. Worth pinning down: an
    // off-by-one here is the difference between a code expiring when the app
    // says it will and expiring ten seconds early.
    const base = 1_700_000_010_000;
    expect(timeStep(base)).toBe(56_666_667);

    const code = generateTotp(RFC_SECRET, base);
    expect(generateTotp(RFC_SECRET, base + 29_999)).toBe(code); // last instant of the step
    expect(generateTotp(RFC_SECRET, base + 30_000)).not.toBe(code); // first of the next
    expect(timeStep(base + 30_000)).toBe(56_666_668);
  });
});
