import { useEffect, useState } from 'react'
import { AEODashboard } from '@goose-aeo/ui'

interface AuthState {
  authenticated: boolean
  user: {
    email: string
    name: string
  }
}

const dataFetcher = async <T,>(path: string): Promise<T> => {
  const response = await fetch(path, { credentials: 'same-origin' })
  if (response.status === 401) {
    window.location.assign(`/auth/google?return_to=${encodeURIComponent(window.location.pathname + window.location.search)}`)
    throw new Error('Authentication required')
  }

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`)
  }

  return (await response.json()) as T
}

export function App() {
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    let isCancelled = false

    const bootstrapAuth = async () => {
      const response = await fetch('/auth/me', { credentials: 'same-origin' })
      if (response.status === 401) {
        window.location.assign(`/auth/google?return_to=${encodeURIComponent(window.location.pathname + window.location.search)}`)
        return
      }

      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`)
      }

      const payload = (await response.json()) as AuthState
      if (!payload.authenticated) {
        window.location.assign(`/auth/google?return_to=${encodeURIComponent(window.location.pathname + window.location.search)}`)
        return
      }

      if (!isCancelled) {
        setIsReady(true)
      }
    }

    void bootstrapAuth().catch((error) => {
      if (!isCancelled) {
        throw error
      }
    })

    return () => {
      isCancelled = true
    }
  }, [])

  if (!isReady) {
    return null
  }

  return <AEODashboard dataFetcher={dataFetcher} companyName="Goose AEO" />
}
