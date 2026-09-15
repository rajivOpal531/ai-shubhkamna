export const config = {
  homeUrl: (import.meta.env.VITE_HOME_URL as string) || '',
  mediaWallUrl: (import.meta.env.VITE_MEDIA_WALL_URL as string) || '',
  createPostByUrlEndpoint: (import.meta.env.VITE_CREATE_POST_BY_URL as string) || '',
  createPostFileEndpoint: (import.meta.env.VITE_CREATE_POST_FILE_URL as string) || '',
  profileUrl: (import.meta.env.VITE_PROFILE_URL as string) || '',
  // Analytics (user-action logging). Empty -> logging is a no-op (safe for local dev).
  analyticsUrl: (import.meta.env.VITE_ANALYTICS_URL as string) || '',
  compositeUrl: (import.meta.env.VITE_COMPOSITE_URL as string) || '',
  // Adjust-photo step one: same host as /composite, but the /cutout route. Overridable if the two
  // ever diverge.
  cutoutUrl:
    (import.meta.env.VITE_CUTOUT_URL as string) ||
    ((import.meta.env.VITE_COMPOSITE_URL as string) || '').replace(/\/composite(\/?)$/, '/cutout$1'),
  useMockProfile: import.meta.env.VITE_USE_MOCK_PROFILE !== 'false',
  useMockComposite: import.meta.env.VITE_USE_MOCK_COMPOSITE !== 'false',
};
