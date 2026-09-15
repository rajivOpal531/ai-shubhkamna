// Decode a JWT's payload (the middle segment) WITHOUT verifying the signature. Only the `data`
// claim is encrypted; the rest of the payload (useridvalue, etc.) is plain base64url JSON, so it is
// safe to read client-side for non-security uses like analytics. Never trust it for authorization.
export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const segment = jwt.split('.')[1];
    if (!segment) return null;
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    // atob gives Latin-1; re-decode as UTF-8 so multi-byte characters survive.
    const json = decodeURIComponent(
      atob(padded)
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    );
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
