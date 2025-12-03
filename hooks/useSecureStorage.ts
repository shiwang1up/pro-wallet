import { useState, useEffect, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';

export async function setStorageItemAsync<T>(key: string, value: T | null) {
  if (value === null) {
    await SecureStore.deleteItemAsync(key);
  } else {
    await SecureStore.setItemAsync(key, JSON.stringify(value));
  }
}

export function useSecureStorage<T>(key: string): [boolean, T | null, (value: T | null) => void] {
  const [loading, setLoading] = useState(true);
  const [value, setValue] = useState<T | null>(null);

  useEffect(() => {
    SecureStore.getItemAsync(key)
      .then(storedValue => {
        if (storedValue) {
          try {
            setValue(JSON.parse(storedValue));
          } catch (e) {
            console.error("Failed to parse value from secure store", e);
            setValue(null);
          }
        }
        setLoading(false);
      })
      .catch(error => {
        console.error("useSecureStorage getItem Error:", error);
        setLoading(false);
      });
  }, [key]);

  const setStoredValue = useCallback(
    (newValue: T | null) => {
      setValue(newValue);
      setStorageItemAsync(key, newValue);
    },
    [key]
  );

  return [loading, value, setStoredValue];
}