export function buildRedirectUrl(base: string, jwt: string, extraParams?: Record<string, string>): string {
  const url = new URL(base);
  url.searchParams.set('jwt', jwt);
  // Optional extra query params (e.g. source=aiShubhKaamna for the Media Wall filter). Only the
  // callers that need them pass them, so the plain home/exit redirect stays untouched.
  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export function redirectWithJwt(base: string, jwt: string, extraParams?: Record<string, string>): void {
  window.location.replace(buildRedirectUrl(base, jwt, extraParams));
}
