/**
 * JS <-> native (NaMo app) bridge for opening the device camera / gallery from inside the app's
 * WebView. In a plain browser none of these bridges exist, so `isNativeApp()` returns false and the
 * callers fall back to the hidden <input type="file"> they already use (keeps localhost dev working).
 *
 * Two directions:
 *   1. JS -> native (SEND) : hand the native side a base64(JSON) payload describing what to open.
 *        Taken verbatim from the app's own externalCall(): fire all three, ignore the ones absent.
 *        Android : window.android.__externalCall(payload)
 *        Global  : window.__externalCall(payload)
 *        iOS     : window.webkit.messageHandlers.callback.postMessage(payload)
 *   2. native -> JS (RETURN) : when the photo is ready the app calls a global JS function with it.
 *        That function's name is NOT in the externalCall snippet, so RESULT_CALLBACK / ERROR_CALLBACK
 *        below are still placeholders -- confirm them with the app team. The camera opens either way;
 *        only the photo coming back into the flow depends on those two names matching.
 */

// --- SEND side (JS -> native), taken from the app's own externalCall(): fire every channel that
//     exists; the ones that don't throw and are ignored. This matches the integration code exactly.
const ANDROID_INTERFACE = 'android'; // window.android (lowercase) -- the app's JS interface object
const ANDROID_METHOD = '__externalCall'; // window.android.__externalCall(base64Payload)
const GLOBAL_CALL = '__externalCall'; // some builds expose it directly: window.__externalCall(base64Payload)
const IOS_MESSAGE_HANDLER = 'callback'; // window.webkit.messageHandlers.callback.postMessage(base64Payload)

// --- RETURN side (native -> JS): the app calls these globals on our page once the user is done.
//     Android fires one media callback for both camera and gallery; iOS has per-source success and
//     cancel callbacks. We register every one and route to the single in-flight request.
const SUCCESS_CALLBACKS = ['sendMedia', 'capturedCamera', 'selectedPhotoGallery'] as const; // photo ready
const CANCEL_CALLBACKS = ['cancelledCamera', 'cancelledAtPreview', 'cancelledPhotoGallery'] as const; // dismissed

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
    android?: AndroidBridge;
    __externalCall?: (payload: string) => void;
    webkit?: { messageHandlers?: Record<string, IosMessageHandler | undefined> };
    // RETURN-side callbacks the native app invokes on this page (see SUCCESS_/CANCEL_CALLBACKS).
    sendMedia?: (data: unknown) => void;
    capturedCamera?: (data: unknown) => void;
    selectedPhotoGallery?: (data: unknown) => void;
    cancelledCamera?: () => void;
    cancelledAtPreview?: () => void;
    cancelledPhotoGallery?: () => void;
  }
}

export function isAndroidBridge(): boolean {
  return (
    typeof window[ANDROID_INTERFACE]?.[ANDROID_METHOD] === 'function' ||
    typeof window[GLOBAL_CALL] === 'function'
  );
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

/** Fire the payload down every native channel that exists (Android JS interface, a global function,
 *  and the iOS message handler), each guarded so a missing/throwing one doesn't stop the others --
 *  exactly like the app's own externalCall(). Returns true if at least one channel accepted it. */
function externalCall(payload: string): boolean {
  let dispatched = false;
  try {
    if (typeof window[ANDROID_INTERFACE]?.[ANDROID_METHOD] === 'function') {
      window[ANDROID_INTERFACE]![ANDROID_METHOD]!(payload);
      dispatched = true;
    }
  } catch {
    // Android channel unavailable/threw -- try the next one.
  }
  try {
    if (typeof window[GLOBAL_CALL] === 'function') {
      window[GLOBAL_CALL]!(payload);
      dispatched = true;
    }
  } catch {
    // global __externalCall unavailable/threw -- try the next one.
  }
  try {
    if (typeof window.webkit?.messageHandlers?.[IOS_MESSAGE_HANDLER]?.postMessage === 'function') {
      window.webkit!.messageHandlers![IOS_MESSAGE_HANDLER]!.postMessage(payload);
      dispatched = true;
    }
  } catch {
    // iOS handler unavailable/threw.
  }
  return dispatched;
}

/** Why a native media request failed. `cancelled` means the user backed out (do nothing); every
 *  other reason means the native path is unusable, so the caller can fall back to the file input. */
export type NativeMediaReason = 'cancelled' | 'empty' | 'unavailable' | 'read-failed' | 'timeout';

export class NativeMediaError extends Error {
  constructor(
    readonly reason: NativeMediaReason,
    message: string,
  ) {
    super(message);
    this.name = 'NativeMediaError';
  }
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

/** Reduce whatever the app passes -- an array of URIs, a JSON-array string like "[content://...]",
 *  a wrapper object, or a bare string -- down to the single string that identifies the photo. */
function unwrapMedia(data: unknown): unknown {
  if (typeof data === 'string') {
    const text = data.trim();
    if (text.startsWith('[')) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed) && parsed.length > 0) return unwrapMedia(parsed[0]);
      } catch {
        // Not JSON -- treat the string as-is below.
      }
    }
    return data;
  }
  if (Array.isArray(data)) return data.length > 0 ? unwrapMedia(data[0]) : data;
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const inner = obj.uri ?? obj.path ?? obj.url ?? obj.base64 ?? obj.data ?? obj.image;
    if (inner !== undefined) return unwrapMedia(inner);
  }
  return data;
}

/** Turn the app's media result into a Blob. The NaMo app hands back a content:// (Android) / file://
 *  (iOS) URI to the captured photo, which we fetch to get the actual bytes; a raw base64 string or a
 *  data: URI is also accepted. Async because a URI has to be fetched. */
async function toBlob(data: unknown): Promise<Blob> {
  const value = unwrapMedia(data);
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Unrecognized native media result');
  }
  const text = value.trim();
  if (text.startsWith('data:')) {
    const comma = text.indexOf(',');
    const mime = text.slice(5, text.indexOf(';') >= 0 ? text.indexOf(';') : comma) || 'image/jpeg';
    return decodeBase64(text.slice(comma + 1), mime);
  }
  if (/^(content|file|blob|https?):/i.test(text)) {
    const response = await fetch(text);
    if (!response.ok) throw new Error(`Could not read the photo from the app (status ${response.status})`);
    return response.blob();
  }
  // No scheme and not a data: URI -> only accept it if it plausibly is base64 image data. This stops
  // junk like "null" from being decoded into a tiny garbage blob that the backend rejects as 415.
  const looksBase64 = text.length >= 100 && /^[A-Za-z0-9+/=\r\n]+$/.test(text);
  if (looksBase64) return decodeBase64(text.replace(/\s+/g, ''), 'image/jpeg');
  throw new Error('No readable image in native result');
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

  const isEmpty = (data: unknown): boolean =>
    data == null || data === 'null' || (typeof data === 'string' && data.trim().length === 0);

  const onSuccess = (data: unknown) => {
    // The app fires the callback with null/"" as an early ack (seen on the gallery path) BEFORE the
    // real image arrives once the user confirms on the native preview. Ignore the empty ack and keep
    // waiting -- do NOT settle -- so the real payload (or a cancel callback) still lands.
    if (isEmpty(data)) return;
    const current = settle();
    if (!current) return;
    toBlob(data).then(
      (blob) => current.resolve(blob),
      () => current.reject(new NativeMediaError('read-failed', 'Could not read the returned photo')),
    );
  };

  const onCancel = () => {
    const current = settle();
    if (!current) return;
    current.reject(new NativeMediaError('cancelled', 'Media selection cancelled'));
  };

  // Assign by name (each has a different signature, so go through an index type rather than the
  // typed Window fields). The Window interface above documents the same names for readers.
  const w = window as unknown as Record<string, (arg?: unknown) => void>;
  for (const name of SUCCESS_CALLBACKS) w[name] = onSuccess;
  for (const name of CANCEL_CALLBACKS) w[name] = onCancel;
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
      if (settle()) reject(new NativeMediaError('timeout', 'Native media request timed out'));
    }, REQUEST_TIMEOUT_MS);
    pending = { resolve, reject, timer };

    if (!externalCall(payload)) {
      settle();
      reject(new NativeMediaError('unavailable', 'No native bridge available'));
    }
  });
}

/** Matches the integration snippet's names. Thin wrappers over requestNativeMedia. */
export const openCamera = (): Promise<Blob> => requestNativeMedia('camera');
export const openGallery = (): Promise<Blob> => requestNativeMedia('gallery');
