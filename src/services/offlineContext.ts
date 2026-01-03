import { offlineStore, type DBContextRecord } from './offlineStore'

export interface OfflineContextValue {
  userId: string
  accountId: string
  updatedAt: string
}

type PartialContextState = {
  userId: string | null
  accountId: string | null
}

type OfflineContextListener = (context: OfflineContextValue | null) => void

let cachedContext: OfflineContextValue | null = null
const partialState: PartialContextState = {
  userId: null,
  accountId: null
}
const listeners = new Set<OfflineContextListener>()
let isInitialized = false
let initPromise: Promise<void> | null = null

const logPrefix = '[offlineContext]'

async function ensureInitialized(): Promise<void> {
  if (isInitialized) {
    return
  }

  if (!initPromise) {
    initPromise = (async () => {
      try {
        await offlineStore.init()
        const stored = await offlineStore.getContext().catch(() => null as DBContextRecord | null)
        if (stored) {
          cachedContext = stored
          partialState.userId = stored.userId
          partialState.accountId = stored.accountId
        }
      } catch (error) {
        console.warn(`${logPrefix} Failed to initialize offline context`, error)
      } finally {
        isInitialized = true
        initPromise = null
      }
    })()
  }

  await initPromise
}

function notifyListeners(): void {
  for (const listener of listeners) {
    try {
      listener(cachedContext)
    } catch (error) {
      console.warn(`${logPrefix} listener threw`, error)
    }
  }
}

function contextsAreEqual(a: OfflineContextValue | null, b: OfflineContextValue | null): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.accountId === b.accountId && a.userId === b.userId
}

async function persistState(): Promise<void> {
  await ensureInitialized()

  if (partialState.userId && partialState.accountId) {
    const nextContext: OfflineContextValue = {
      userId: partialState.userId,
      accountId: partialState.accountId,
      updatedAt: new Date().toISOString()
    }

    if (contextsAreEqual(cachedContext, nextContext)) {
      return
    }

    cachedContext = nextContext
    try {
      await offlineStore.saveContext(nextContext)
    } catch (error) {
      console.warn(`${logPrefix} Failed to persist context`, error)
    }
    notifyListeners()
    return
  }

  if (cachedContext) {
    cachedContext = null
    try {
      await offlineStore.clearContext()
    } catch (error) {
      console.warn(`${logPrefix} Failed to clear context`, error)
    }
    notifyListeners()
  }
}

export async function initOfflineContext(): Promise<void> {
  await ensureInitialized()
}

export function getOfflineContext(): OfflineContextValue | null {
  return cachedContext
}

export function getLastKnownUserId(): string | null {
  return partialState.userId ?? cachedContext?.userId ?? null
}

export async function updateOfflineContext(partial: { userId?: string | null; accountId?: string | null }): Promise<void> {
  if ('userId' in partial) {
    partialState.userId = partial.userId ?? null
  }

  if ('accountId' in partial) {
    partialState.accountId = partial.accountId ?? null
  }

  await persistState()
}

export function subscribeToOfflineContext(listener: OfflineContextListener): () => void {
  listeners.add(listener)

  void ensureInitialized().then(() => {
    listener(cachedContext)
  })

  return () => {
    listeners.delete(listener)
  }
}
