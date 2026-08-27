import { createContext, useContext, useState, useCallback, useEffect } from "react";
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
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session, isPending } = (authClient as any).useSession();

  useEffect(() => {
    if (!isPending) {
      if (session?.user) {
        setUser({
          id: session.user.id,
          name: session.user.name || session.user.email,
          email: session.user.email,
          image: session.user.image ?? undefined,
        });
      } else {
        setUser(null);
      }
      setIsLoading(false);
    }
  }, [session, isPending]);

  const signIn = useCallback(() => {
    window.location.href = "/login";
  }, []);

  const signOut = useCallback(async () => {
    await authClient.signOut();
    setUser(null);
    window.location.href = "/login";
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading: isLoading || isPending,
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
