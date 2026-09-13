import { AppBackground } from './AppBackground';

export function MissingJwt() {
  return (
    <div className="missing-jwt">
      <AppBackground />
      <p>This page can&apos;t be opened directly. Please return to the app and try again.</p>
    </div>
  );
}
