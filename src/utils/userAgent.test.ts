import { describe, expect, it } from 'vitest';
import { isAndroidWebView } from './userAgent';

describe('isAndroidWebView', () => {
  it.each([
    {
      name: 'Chrome on Android (OnePlus Nord 3)',
      ua: 'Mozilla/5.0 (Linux; Android 14; CPH2491) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
      want: false,
    },
    {
      name: 'Android System WebView inside a native app',
      ua: 'Mozilla/5.0 (Linux; Android 14; CPH2491 Build/UKQ1.230924.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.127 Mobile Safari/537.36',
      want: true,
    },
    {
      name: 'Samsung Internet',
      ua: 'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
      want: false,
    },
    {
      name: 'iPhone Safari',
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      want: false,
    },
    {
      name: 'iOS WKWebView inside a native app (iOS honours capture)',
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
      want: false,
    },
    {
      name: 'desktop Chrome',
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      want: false,
    },
  ])('$name -> $want', ({ ua, want }) => {
    expect(isAndroidWebView(ua)).toBe(want);
  });
});
