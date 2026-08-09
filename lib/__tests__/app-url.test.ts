import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ============================================================================
 * WHERE THE APPLICATION THINKS IT LIVES
 * ----------------------------------------------------------------------------
 * Owner report, Session 20: *"that activation link is still in localhost."*
 *
 * Five files each carried their own `process.env.NEXT_PUBLIC_APP_URL ||
 * 'http://localhost:4310'`, and the failure is silent — the link is well-formed,
 * the email sends, and it is only useless when somebody clicks it. Nothing in a
 * build or a smoke test can catch that, which is exactly why it survived.
 *
 * So the shared helper gets a test. `next/headers` is mocked because these are
 * unit tests with no request in scope, which is also one of the cases the helper
 * has to handle.
 * ========================================================================= */

const headerStore = new Map<string, string>();
let headersThrows = false;

vi.mock('next/headers', () => ({
  headers: async () => {
    if (headersThrows) throw new Error('called outside a request');
    return { get: (key: string) => headerStore.get(key.toLowerCase()) ?? null };
  },
}));

const { appUrl } = await import('../app-url');

beforeEach(() => {
  headerStore.clear();
  headersThrows = false;
  delete process.env.NEXT_PUBLIC_APP_URL;
});

describe('the configured value wins', () => {
  it('uses NEXT_PUBLIC_APP_URL when it is set', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://cni-crm.vercel.app';
    headerStore.set('x-forwarded-host', 'someone-elses-domain.example');
    expect(await appUrl()).toBe('https://cni-crm.vercel.app');
  });

  it('trims a trailing slash, so links never contain a double slash', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://cni-crm.vercel.app/';
    expect(`${await appUrl()}/activate`).toBe('https://cni-crm.vercel.app/activate');
  });

  it('ignores it when it is blank rather than treating "" as a host', async () => {
    process.env.NEXT_PUBLIC_APP_URL = '   ';
    headerStore.set('host', 'cni-crm.vercel.app');
    expect(await appUrl()).toBe('https://cni-crm.vercel.app');
  });
});

describe('otherwise it asks the request — the whole point of the change', () => {
  it('prefers x-forwarded-host, which is what the platform proxy sets', async () => {
    headerStore.set('x-forwarded-host', 'cni-crm.vercel.app');
    headerStore.set('host', 'internal-function-hostname');
    expect(await appUrl()).toBe('https://cni-crm.vercel.app');
  });

  it('falls back to host when there is no proxy in front', async () => {
    headerStore.set('host', '192.168.100.131:4310');
    headerStore.set('x-forwarded-proto', 'http');
    expect(await appUrl()).toBe('http://192.168.100.131:4310');
  });

  it('honours x-forwarded-proto', async () => {
    headerStore.set('host', 'cni-crm.vercel.app');
    headerStore.set('x-forwarded-proto', 'https');
    expect(await appUrl()).toBe('https://cni-crm.vercel.app');
  });

  it('assumes http for localhost and https for everything else', async () => {
    headerStore.set('host', 'localhost:4310');
    expect(await appUrl()).toBe('http://localhost:4310');

    headerStore.clear();
    headerStore.set('host', 'cni-crm.vercel.app');
    expect(await appUrl()).toBe('https://cni-crm.vercel.app');
  });

  /* The reported bug, as a test. Browsing the dev server over the LAN used to
     produce a localhost link, which is useless on any other device. */
  it('a LAN request produces a LAN link, not localhost', async () => {
    headerStore.set('host', '192.168.100.131:4310');
    headerStore.set('x-forwarded-proto', 'http');
    const link = `${await appUrl()}/activate?token=abc`;
    expect(link).toBe('http://192.168.100.131:4310/activate?token=abc');
    expect(link).not.toContain('localhost');
  });
});

describe('no request in scope — a cron run, a script, a test', () => {
  it('falls back to the dev origin rather than throwing', async () => {
    headersThrows = true;
    expect(await appUrl()).toBe('http://localhost:4310');
  });

  it('but the configured value still wins there, which is what cron needs', async () => {
    headersThrows = true;
    process.env.NEXT_PUBLIC_APP_URL = 'https://cni-crm.vercel.app';
    expect(await appUrl()).toBe('https://cni-crm.vercel.app');
  });

  it('and returns the fallback when a request carries no host at all', async () => {
    expect(await appUrl()).toBe('http://localhost:4310');
  });
});
