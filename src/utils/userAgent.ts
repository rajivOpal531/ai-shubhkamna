// Android System WebView (a WebView inside a native app, e.g. the NaMo app) marks its user agent with
// "; wv)". Chrome, Samsung Internet and iOS web views do not.
export function isAndroidWebView(userAgent: string): boolean {
  return /\bAndroid\b/.test(userAgent) && /;\s*wv\)/.test(userAgent);
}
