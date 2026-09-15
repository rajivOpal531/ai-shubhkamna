/**
 * JS <-> native (NaMo app) bridge for opening the device camera / gallery from inside the app's
 * WebView. In a plain browser none of these bridges exist, so `isNativeApp()` returns false and the
 * callers fall back to the hidden <input type="file"> they already use (keeps localhost dev working).
 *
 * Two directions, both a CONTRACT with the Android / iOS teams:
 *   1. JS -> native : we hand the native side a base64(JSON) payload describing what to open.
 *        Android : window.<ANDROID_INTERFACE>.<ANDROID_METHOD>(payload)  (addJavascriptInterface)
 *        iOS     : window.webkit.messageHandlers.<IOS_MESSAGE_HANDLER>.postMessage(payload)
 *   2. native -> JS : when the user has picked/taken a photo, native calls a global callback:
 *        success : window.<RESULT_CALLBACK>(result)   // base64 / data-URI / { base64 } / [ ... ]
 *        cancel  : window.<ERROR_CALLBACK>(message?)  // user cancelled or a limit failed
 *
 * ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 * │ IMPORTANT: the five names below MUST match exactly what the Android / iOS apps use. They   │
 * │ are the only things to change if the native contract differs — nothing else in this file.  │
 * └──────────────────────────────────────────────────────────────────────────────────────────┘
 */

const ANDROID_INTERFACE = 'Android'; // window.Android, injected via addJavascriptInterface(obj, "Android")
const ANDROID_METHOD = 'openMedia'; // window.Android.openMedia(base64Payload)
const IOS_MESSAGE_HANDLER = 'openMedia'; // window.webkit.messageHandlers.openMedia.postMessage(base64Payload)
const RESULT_CALLBACK = 'onNativeMediaResult'; // native -> JS on success
const ERROR_CALLBACK = 'onNativeMediaError'; // native -> JS on cancel / failure

// Native pickers can take a while (permission prompt + capture); give up eventually so a dropped
// callback never leaves the UI stuck on a spinner.
const REQUEST_TIMEOUT_MS = 120_000;

// Same list the integration snippet uses; sent to native so it can filter what the user may pick.
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.raw', '.svg', '.heif', '.heic'];

export type MediaKind = 'camera' | 'gallery';

type AndroidBridge = Record<string, ((payload: string) => void) | undefined>;
type IosMessageHandler = { postMessage: (payload: string) => void };

declare global {
  interface Window {
    Android?: AndroidBridge;
    webkit?: { messageHandlers?: Record<string, IosMessageHandler | undefined> };
    onNativeMediaResult?: (result: unknown) => void;
    onNativeMediaError?: (message?: unknown) => void;
  }
}

export function isAndroidBridge(): boolean {
  return typeof window[ANDROID_INTERFACE]?.[ANDROID_METHOD] === 'function';
}

export function isIosBridge(): boolean {
  return typeof window.webkit?.messageHandlers?.[IOS_MESSAGE_HANDLER]?.postMessage === 'function';
}

/** True when running inside the native app WebView (either platform), false in a plain browser. */
export function isNativeApp(): boolean {
  return isAndroidBridge() || isIosBridge();
}

function buildPayload(kind: MediaKind): string {
  const common = {
    minSize: 0,
    maxSize: 15000, // KB (~15 MB)
    compression: 0.5,
    allowedExtensions: ALLOWED_EXTENSIONS,
  };
  const request =
    kind === 'camera'
      ? { type: 'camera', isFrontCam: false, ...common }
      : { type: 'gallery', count: 1, ...common };
  return btoa(JSON.stringify(request));
}

/** Hand the payload to whichever native bridge exists. Returns false if neither is present. */
function externalCall(payload: string): boolean {
  if (isAndroidBridge()) {
    window[ANDROID_INTERFACE]![ANDROID_METHOD]!(payload);
    return true;
  }
  if (isIosBridge()) {
    window.webkit!.messageHandlers![IOS_MESSAGE_HANDLER]!.postMessage(payload);
    return true;
  }
  return false;
}

type Pending = {
  resolve: (blob: Blob) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

// Only one media request is ever in flight (the UI is a single-shot flow), so a module-level slot is
// enough. A new request supersedes any earlier one still waiting.
let pending: Pending | null = null;
let callbacksInstalled = false;

function decodeBase64(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Accepts the shapes native may send: a raw base64 string, a data URI, { base64 } / { data } /
 *  { image } / { uri } (optionally with mimeType), or an array of any of those (first entry wins). */
function resultToBlob(result: unknown): Blob {
  if (typeof result === 'string') {
    const value = result.trim();
    if (value.startsWith('data:')) {
      const comma = value.indexOf(',');
      const mime = value.slice(5, value.indexOf(';') >= 0 ? value.indexOf(';') : comma) || 'image/jpeg';
      return decodeBase64(value.slice(comma + 1), mime);
    }
    return decodeBase64(value, 'image/jpeg');
  }
  if (Array.isArray(result) && result.length > 0) {
    return resultToBlob(result[0]);
  }
  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    const data = obj.base64 ?? obj.data ?? obj.image ?? obj.uri;
    if (typeof data === 'string') {
      const mime = typeof obj.mimeType === 'string' ? obj.mimeType : 'image/jpeg';
      // data URIs carry their own mime; the string branch handles that.
      return resultToBlob(data.startsWith('data:') ? data : `data:${mime};base64,${data}`);
    }
  }
  throw new Error('Unrecognized native media result');
}

function settle(): Pending | null {
  const current = pending;
  if (current) {
    clearTimeout(current.timer);
    pending = null;
  }
  return current;
}

function installCallbacks(): void {
  if (callbacksInstalled) return;
  callbacksInstalled = true;

  window[RESULT_CALLBACK] = (result: unknown) => {
    const current = settle();
    if (!current) return;
    try {
      current.resolve(resultToBlob(result));
    } catch (err) {
      current.reject(err instanceof Error ? err : new Error('Could not read native media result'));
    }
  };

  window[ERROR_CALLBACK] = (message?: unknown) => {
    const current = settle();
    if (!current) return;
    current.reject(new Error(typeof message === 'string' && message ? message : 'Media selection cancelled'));
  };
}

/** Open the native camera/gallery and resolve with the chosen photo as a Blob. Rejects on cancel,
 *  timeout, or when no native bridge is present. Only meaningful inside the app (guard with
 *  isNativeApp() at the call site). */
export function requestNativeMedia(kind: MediaKind): Promise<Blob> {
  installCallbacks();

  // Supersede any request still waiting so its promise never hangs.
  const stale = settle();
  if (stale) stale.reject(new Error('Superseded by a new media request'));

  const payload = buildPayload(kind);
  return new Promise<Blob>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settle()) reject(new Error('Native media request timed out'));
    }, REQUEST_TIMEOUT_MS);
    pending = { resolve, reject, timer };

    if (!externalCall(payload)) {
      settle();
      reject(new Error('No native bridge available'));
    }
  });
}

/** Matches the integration snippet's names. Thin wrappers over requestNativeMedia. */
export const openCamera = (): Promise<Blob> => requestNativeMedia('camera');
export const openGallery = (): Promise<Blob> => requestNativeMedia('gallery');
