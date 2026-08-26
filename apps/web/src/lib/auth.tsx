import { createContext, useContext, useState, useCallback } from "react";

interface AuthUser {
  id: string;
  name: string;
  email: string;
  image?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  signIn: () => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: false,
  signIn: () => {},
  signOut: () => {},
});

// M0 stub: auth is bypassed for scaffold. Replace with Better Auth session hook in M1.
const STUB_USER: AuthUser = {
  id: "stub-user-1",
  name: "Pixel Panda",
  email: "pixel@sponsee.app",
  image: "/pixelpanda-avatar.png",
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(STUB_USER);
  const isLoading = false;

  const signIn = useCallback(() => {
    setUser(STUB_USER);
  }, []);

  const signOut = useCallback(() => {
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
