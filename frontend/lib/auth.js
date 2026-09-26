"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { request, session } from "./api";
const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(null);
  async function restore() {
    setLoading(true);
    setError(null);
    if (!session.get()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setUser(await request("/auth/current-user"));
    } catch (e) {
      if (e.status !== 401) setError(e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    restore();
    const expired = () => {
      setUser(null);
      setError(null);
    };
    window.addEventListener("datavault:expired", expired);
    return () => window.removeEventListener("datavault:expired", expired);
  }, []);
  useEffect(() => {
    if (!user) return;
    try {
      const encoded = session.get()?.split(".")[1];
      const payload = JSON.parse(
        atob(encoded.replace(/-/g, "+").replace(/_/g, "/")),
      );
      if (!payload.exp) return;
      const expire = () => {
        session.clear();
        window.dispatchEvent(new Event("datavault:expired"));
      };
      const remaining = payload.exp * 1000 - Date.now();
      if (remaining <= 0) {
        expire();
        return;
      }
      const timer = setTimeout(expire, remaining);
      return () => clearTimeout(timer);
    } catch {
      /* The backend validates token authenticity on every request. */
    }
  }, [user]);
  async function login(body) {
    const result = await request("/auth/sign-in", {
      method: "POST",
      body,
      public: true,
    });
    session.set(result.accessToken);
    setUser(await request("/auth/current-user"));
  }
  function logout() {
    session.clear();
    setUser(null);
    setError(null);
  }
  return (
    <AuthContext.Provider
      value={{
        user,
        setUser,
        loading,
        error,
        restore,
        login,
        logout,
        isAdmin: user?.role === "company_owner",
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export const useAuth = () => useContext(AuthContext);
