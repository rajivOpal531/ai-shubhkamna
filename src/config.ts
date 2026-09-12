export const config = {
  homeUrl: import.meta.env.VITE_HOME_URL as string,
  mediaWallUrl: import.meta.env.VITE_MEDIA_WALL_URL as string,
  createPostByUrlEndpoint: import.meta.env.VITE_CREATE_POST_BY_URL as string,
  createPostFileEndpoint: import.meta.env.VITE_CREATE_POST_FILE_URL as string,
  profileUrl: (import.meta.env.VITE_PROFILE_URL as string) || '',
  compositeUrl: (import.meta.env.VITE_COMPOSITE_URL as string) || '',
  useMockProfile: import.meta.env.VITE_USE_MOCK_PROFILE !== 'false',
  useMockComposite: import.meta.env.VITE_USE_MOCK_COMPOSITE !== 'false',
};
