import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('mobile PWA metadata', () => {
  it('declares a standalone mobile start page and install icons', () => {
    const manifest = JSON.parse(readFileSync(resolve('public/manifest.webmanifest'), 'utf8')) as {
      display: string; start_url: string; theme_color: string; icons: Array<{ src: string; sizes: string }>;
    };
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/m');
    expect(manifest.theme_color).toBe('#07131b');
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: '/icons/dsa-192.png', sizes: '192x192' }),
      expect.objectContaining({ src: '/icons/dsa-512.png', sizes: '512x512' }),
    ]));
  });

  it('links the manifest and mobile theme metadata from the HTML shell', () => {
    const html = readFileSync(resolve('index.html'), 'utf8');
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('name="theme-color" content="#07131b"');
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
  });
});
