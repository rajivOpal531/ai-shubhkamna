import { createContext, useContext, useState, type ReactNode } from 'react';

const JwtContext = createContext<string | null>(null);

export function readJwtFromLocation(search: string): string | null {
  return new URLSearchParams(search).get('jwt');
}

type JwtProviderProps = {
  children: ReactNode;
  missingJwtFallback: ReactNode;
  search?: string;
};

export function JwtProvider({ children, missingJwtFallback, search = window.location.search }: JwtProviderProps) {
  const [jwt] = useState<string | null>(() => readJwtFromLocation(search));

  if (!jwt) {
    return <>{missingJwtFallback}</>;
  }

  return <JwtContext.Provider value={jwt}>{children}</JwtContext.Provider>;
}

export function useJwt(): string {
  const jwt = useContext(JwtContext);
  if (!jwt) {
    throw new Error('useJwt must be used within a JwtProvider that has a valid jwt');
  }
  return jwt;
}
