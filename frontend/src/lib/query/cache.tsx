"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

type CacheEntry<T> = {
  data?: T;
  error?: unknown;
  updatedAt: number;
  promise?: Promise<T>;
};

export const queryCache = new Map<string, CacheEntry<unknown>>();

type QueryProviderValue = {
  invalidate: (prefix?: string) => void;
};

const QueryContext = createContext<QueryProviderValue>({
  invalidate: (prefix?: string) => {
    if (!prefix) {
      queryCache.clear();
      return;
    }

    for (const key of Array.from(queryCache.keys())) {
      if (key.startsWith(prefix)) {
        queryCache.delete(key);
      }
    }
  },
});

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo<QueryProviderValue>(
    () => ({
      invalidate: (prefix?: string) => {
        if (!prefix) {
          queryCache.clear();
          return;
        }

        for (const key of Array.from(queryCache.keys())) {
          if (key.startsWith(prefix)) {
            queryCache.delete(key);
          }
        }
      },
    }),
    [],
  );

  return <QueryContext.Provider value={value}>{children}</QueryContext.Provider>;
}

export function useQueryCache() {
  return useContext(QueryContext);
}

export function useCachedQuery<T>({
  queryKey,
  queryFn,
  staleTime = 0,
  enabled = true,
}: {
  queryKey: any[];
  queryFn: () => Promise<T>;
  staleTime?: number;
  enabled?: boolean;
}) {
  const key = JSON.stringify(queryKey);
  const initialEntry = queryCache.get(key) as CacheEntry<T> | undefined;
  const isFresh =
    initialEntry &&
    initialEntry.updatedAt > 0 &&
    Date.now() - initialEntry.updatedAt < staleTime;

  const [data, setData] = useState<T | undefined>(
    isFresh ? initialEntry?.data : undefined,
  );
  const [error, setError] = useState<unknown>(initialEntry?.error);
  const [isLoading, setIsLoading] = useState<boolean>(enabled && !isFresh);

    const queryFnRef = React.useRef(queryFn);
    queryFnRef.current = queryFn;
    const activeKeyRef = React.useRef(key);
    activeKeyRef.current = key;

    useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    const cached = queryCache.get(key) as CacheEntry<T> | undefined;
    const fresh =
      cached &&
      cached.updatedAt > 0 &&
      Date.now() - cached.updatedAt < staleTime &&
      cached.data !== undefined;

    if (fresh) {
      setData(cached.data);
      setError(cached.error);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    const pendingPromise =
      cached?.promise ??
      queryFnRef.current().then((result) => {
        queryCache.set(key, {
          data: result,
          error: undefined,
          updatedAt: Date.now(),
        });
        return result;
      });

    queryCache.set(key, {
      ...cached,
      promise: pendingPromise,
      updatedAt: cached?.updatedAt ?? 0,
    });

    pendingPromise
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(undefined);
        setIsLoading(false);
      })
      .catch((err) => {
        queryCache.set(key, {
          data: undefined,
          error: err,
          updatedAt: Date.now(),
        });
        if (cancelled) return;
        setError(err);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, key, staleTime]);

  return {
    data,
    error,
    isLoading,
    refetch: async (options?: { silent?: boolean }) => {
      const refetchKey = key;
      const silent = Boolean(options?.silent);
      if (!silent) {
        setIsLoading(true);
      }
      try {
        const result = await queryFnRef.current();
        queryCache.set(refetchKey, {
          data: result,
          error: undefined,
          updatedAt: Date.now(),
        });
        if (activeKeyRef.current !== refetchKey) return;
        setData(result);
        setError(undefined);
      } catch (err) {
        if (activeKeyRef.current !== refetchKey) return;
        if (!silent) {
          setError(err);
        }
      } finally {
        if (!silent && activeKeyRef.current === refetchKey) {
          setIsLoading(false);
        }
      }
    },
  };
}
