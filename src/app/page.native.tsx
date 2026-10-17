'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/auth/provider';

/**
 * Стартовый экран приложения: лендинга нет — вошедший пользователь уходит на дашборд,
 * остальные на вход.
 */
export default function NativeHomePage() {
  const router = useRouter();
  const { user, refreshUser } = useAuth();
  const signedIn = Boolean(user?.username);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (signedIn) {
      router.replace('/dashboard');
      return;
    }
    let cancelled = false;
    void refreshUser().finally(() => {
      if (!cancelled) setChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshUser, router, signedIn]);

  useEffect(() => {
    if (checked && !signedIn) router.replace('/login');
  }, [checked, router, signedIn]);

  return null;
}
