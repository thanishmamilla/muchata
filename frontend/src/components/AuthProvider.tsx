'use client';

import React, { useEffect } from 'react';
import { useAuthStore } from '../stores/useAuthStore';

interface AuthProviderProps {
  children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const { login, logout, setLoading, isLoading } = useAuthStore();

  useEffect(() => {
    const checkSession = async () => {
      try {
        const backendUrl = process.env.NEXT_PUBLIC_SIGNALING_URL || 'http://localhost:5000';
        const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const res = await fetch(`${backendUrl}/api/auth/me`, {
          method: 'GET',
          headers,
          // Send credentials (accessToken cookie)
          credentials: 'include',
        });

        if (res.ok) {
          const data = await res.json();
          // Extract token from cookie (cookies are set HttpOnly, but backend returns user details)
          login(data.user, data.accessToken || '');
        } else {
          logout();
        }
      } catch (err) {
        console.warn('Failed to restore session:', err);
        logout();
      } finally {
        setLoading(false);
      }
    };

    checkSession();
  }, [login, logout, setLoading]);

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-[#0b0f19] text-white">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-500 border-t-transparent"></div>
        <p className="mt-4 text-slate-400 font-medium">Securing session...</p>
      </div>
    );
  }

  return <>{children}</>;
};
