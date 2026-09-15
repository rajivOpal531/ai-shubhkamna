// User-action analytics for the AI Shubhkamna landing flow. POSTs one event per action to the
// captureLogs/saveAnalytics endpoint. Fire-and-forget: it never throws and never blocks the UI, so a
// failed log can't break the card flow. Disabled (no-op) when VITE_ANALYTICS_URL is unset.
import { config } from '../config';
import { isNativeApp } from './nativeBridge';
import { decodeJwtPayload } from '../utils/jwtPayload';

const PROGRAM = 'birthday_2026';

// The `page` value each screen reports to the analytics API.
export const ANALYTICS_PAGES = {
  landing: 'ai_subhkamnaye_landing',
  instruction: 'ai_subhkamnaye_instruction', // the "tips for a perfect photo" screen
  preview: 'ai_subhkamnaye_preview',
  inspire: 'ai_subhkamnaye_inspire_me_page', // the "Popular Messages" sheet
} as const;

export type AnalyticsAction =
  | 'pageload'
  | 'back'
  | 'select_frame'
  | 'capture'
  | 'upload'
  | 'proceed'
  | 'inspire me'
  | 'retake'
  | 'post'
  | 'select_option'
  | 'cross';

// A page-bound logger handed to a screen so it only supplies the action + extras.
export type TrackFn = (action: AnalyticsAction, extras?: AnalyticsExtras) => void;

export type AnalyticsContext = {
  jwt: string;
  state?: string;
  constituency?: string;
  language?: string; // "eng" | "hin"; defaults to "eng"
};

// Per-action optional fields (the API's own field names). `parameters` is the generic slot the
// backend expects: the name for `confirm`, "Selected_template<n>" for `select_frame`, etc.
export type AnalyticsExtras = {
  parameters?: string;
  template?: string;
  name?: string;
  uploadDuration?: string;
  caption?: string;
  pageLoadTime?: string;
};

// Device OS the API records ("ios" / "android"); the native bridge is authoritative when present,
// otherwise fall back to the user agent.
function detectDevice(userAgent: string = navigator.userAgent): string {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return '';
}

function readUuid(jwt: string): string {
  const payload = decodeJwtPayload(jwt);
  const value = payload?.useridvalue ?? payload?.uuid ?? payload?.userid;
  return typeof value === 'string' ? value : '';
}

export function logAnalytics(
  page: string,
  action: AnalyticsAction,
  ctx: AnalyticsContext,
  extras: AnalyticsExtras = {},
): void {
  if (!config.analyticsUrl) return; // logging disabled (e.g. local dev)

  const body = {
    program: PROGRAM,
    page,
    userAction: action,
    uuid: readUuid(ctx.jwt),
    device: detectDevice(),
    parameters: extras.parameters ?? '',
    language: ctx.language ?? 'eng',
    template: extras.template ?? '',
    pageLoadTime: extras.pageLoadTime ?? '',
    name: extras.name ?? '',
    uploadDuration: extras.uploadDuration ?? '',
    caption: extras.caption ?? '',
    platform: isNativeApp() ? 'app' : 'web',
    state: ctx.state ?? '',
    constituency: ctx.constituency ?? '',
  };

  try {
    // keepalive lets the request outlive a redirect/navigation (e.g. logging on the way out).
    void fetch(config.analyticsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
        Authorization: `Bearer ${ctx.jwt}`,
      },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {
      // swallow: analytics must never surface an error to the user
    });
  } catch {
    // swallow synchronous failures too (e.g. fetch unavailable)
  }
}
