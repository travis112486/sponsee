/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useCallback } from "react";
import { authClient } from "./auth-client";

interface AuthUser {
  id: string;
  name: string;
  email: string;
  image?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signIn: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  signIn: () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = authClient.useSession();

  const user: AuthUser | null = session?.user
    ? {
        id: session.user.id,
        name: session.user.name || session.user.email,
        email: session.user.email,
        image: session.user.image ?? undefined,
      }
    : null;

  const signIn = useCallback(() => {
    window.location.href = "/login";
  }, []);

  const signOut = useCallback(async () => {
    await authClient.signOut();
    window.location.href = "/login";
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading: isPending,
        isAuthenticated: !!user,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
