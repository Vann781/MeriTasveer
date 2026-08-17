import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../services/api.js';

const AuthContext = createContext(null);

/** Loads the signed-in participant once and shares them with every page. */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null)) // 401 simply means "not signed in"
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      async signOut() {
        await api.logout().catch(() => {});
        setUser(null);
      },
    }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
