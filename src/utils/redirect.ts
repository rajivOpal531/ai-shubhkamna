export function buildRedirectUrl(base: string, jwt: string): string {
  const url = new URL(base);
  url.searchParams.set('jwt', jwt);
  return url.toString();
}

export function redirectWithJwt(base: string, jwt: string): void {
  window.location.replace(buildRedirectUrl(base, jwt));
}
