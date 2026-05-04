import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cookieSession from 'cookie-session'
import express from 'express'
import passport from 'passport'
import { Strategy as GoogleStrategy, type Profile } from 'passport-google-oauth20'
import { AEOClient } from '@goose-aeo/core'

interface ServerOptions {
  port?: number
  configPath?: string
  pricingPath?: string
  dataCwd?: string
  appRoot?: string
}

interface AuthenticatedUser {
  email: string
  name: string
}

declare global {
  namespace Express {
    interface User extends AuthenticatedUser {}
  }
}

const parseIntParam = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const requireEnv = (name: string): string => {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`)
  }

  return value
}

const resolveCallbackUrl = (baseUrl: string): string => {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  return `${normalizedBaseUrl}/auth/google/callback`
}

const extractEmail = (profile: Profile): { email: string; verified: boolean } | null => {
  const account = profile.emails?.find((candidate) => candidate.value)
  if (!account?.value) {
    return null
  }

  return {
    email: account.value.trim().toLowerCase(),
    verified: account.verified ?? false,
  }
}

const withClient = async <T>(options: ServerOptions, fn: (client: AEOClient) => Promise<T>): Promise<T> => {
  const client = await AEOClient.create({
    cwd: options.dataCwd ?? process.cwd(),
    configPath: options.configPath,
    pricingPath: options.pricingPath,
  })

  try {
    return await fn(client)
  } finally {
    client.close()
  }
}

export async function startDashboardServer(options: ServerOptions = {}) {
  const app = express()
  const port = options.port ?? 3847
  const appRoot =
    options.appRoot ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const googleClientId = requireEnv('GOOSE_AEO_DASHBOARD_GOOGLE_CLIENT_ID')
  const googleClientSecret = requireEnv('GOOSE_AEO_DASHBOARD_GOOGLE_CLIENT_SECRET')
  const baseUrl = requireEnv('GOOSE_AEO_DASHBOARD_BASE_URL')
  const sessionSecret = requireEnv('GOOSE_AEO_DASHBOARD_SESSION_SECRET')
  const allowedEmailDomain = requireEnv('GOOSE_AEO_DASHBOARD_ALLOWED_EMAIL_DOMAIN')
    .replace(/^@+/, '')
    .toLowerCase()
  const callbackUrl = resolveCallbackUrl(baseUrl)

  app.set('trust proxy', 1)

  passport.serializeUser((user, done) => {
    done(null, user)
  })

  passport.deserializeUser<AuthenticatedUser>((user, done) => {
    done(null, user)
  })

  passport.use(
    new GoogleStrategy(
      {
        clientID: googleClientId,
        clientSecret: googleClientSecret,
        callbackURL: callbackUrl,
      },
      (_accessToken, _refreshToken, profile, done) => {
        const account = extractEmail(profile)
        if (!account?.verified) {
          done(null, false, { message: 'Verified Google email is required' })
          return
        }

        if (!account.email.endsWith(`@${allowedEmailDomain}`)) {
          done(null, false, { message: 'Google Workspace domain is not allowed' })
          return
        }

        done(null, {
          email: account.email,
          name: profile.displayName || account.email,
        })
      },
    ),
  )

  app.use(
    cookieSession({
      name: 'goose-aeo-dashboard-session',
      keys: [sessionSecret],
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax',
      secure: baseUrl.startsWith('https://'),
    }),
  )
  app.use(passport.initialize())
  app.use(passport.session())

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true })
  })

  app.get('/auth/google', (req, res, next) => {
    const state = typeof req.query.return_to === 'string' ? req.query.return_to : '/'
    passport.authenticate('google', {
      scope: ['openid', 'profile', 'email'],
      hd: allowedEmailDomain,
      state,
    })(req, res, next)
  })

  app.get(
    '/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/auth/unauthorized', session: true }),
    (req, res) => {
      const destination = typeof req.query.state === 'string' && req.query.state.startsWith('/')
        ? req.query.state
        : '/'
      res.redirect(destination)
    },
  )

  app.get('/auth/me', (req, res) => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ authenticated: false })
      return
    }

    res.json({
      authenticated: true,
      user: req.user,
    })
  })

  app.get('/auth/logout', (req, res, next) => {
    req.logout((error) => {
      if (error) {
        next(error)
        return
      }

      req.session = null
      res.redirect('/auth/signed-out')
    })
  })

  app.get('/auth/unauthorized', (_req, res) => {
    res.status(403).type('html').send('<h1>Access denied</h1><p>Please sign in with a verified @clinikally.com Google account.</p>')
  })

  app.get('/auth/signed-out', (_req, res) => {
    res.status(200).type('html').send('<h1>Signed out</h1><p><a href="/auth/google">Sign in again</a></p>')
  })

  app.use((req, res, next) => {
    if (req.path === '/healthz' || req.path.startsWith('/auth/')) {
      next()
      return
    }

    if (req.isAuthenticated()) {
      next()
      return
    }

    if (req.path.startsWith('/api/')) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }

    const returnTo = req.originalUrl && req.originalUrl.startsWith('/') ? req.originalUrl : '/'
    res.redirect(`/auth/google?return_to=${encodeURIComponent(returnTo)}`)
  })

  app.get('/api/status', async (_req, res) => {
    try {
      const payload = await withClient(options, (client) => client.status())
      res.json(payload)
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  app.get('/api/runs', async (req, res) => {
    try {
      const payload = await withClient(options, (client) =>
        client.dashboard.runs({
          limit: parseIntParam(req.query.limit as string | undefined, 20),
          offset: parseIntParam(req.query.offset as string | undefined, 0),
        }),
      )
      res.json(payload)
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  app.get('/api/runs/:id', async (req, res) => {
    try {
      const payload = await withClient(options, (client) => client.dashboard.run(req.params.id))
      if (!payload) {
        res.status(404).json({ error: 'Run not found' })
        return
      }

      res.json(payload)
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  app.get('/api/runs/:id/metrics', async (req, res) => {
    try {
      const payload = await withClient(options, (client) => client.dashboard.metrics(req.params.id))
      res.json(payload)
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  app.get('/api/runs/:id/results', async (req, res) => {
    try {
      const payload = await withClient(options, (client) =>
        client.dashboard.results({
          runId: req.params.id,
          provider: req.query.provider as string | undefined,
          queryId: req.query.query_id as string | undefined,
          limit: parseIntParam(req.query.limit as string | undefined, 100),
          offset: parseIntParam(req.query.offset as string | undefined, 0),
        }),
      )
      res.json(payload)
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  app.get('/api/queries', async (_req, res) => {
    try {
      const payload = await withClient(options, (client) => client.dashboard.queries())
      res.json(payload)
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  app.get('/api/diff', async (req, res) => {
    const run1 = req.query.run1 as string | undefined
    const run2 = req.query.run2 as string | undefined
    if (!run1 || !run2) {
      res.status(400).json({ error: 'run1 and run2 are required' })
      return
    }

    try {
      const payload = await withClient(options, (client) => client.diff(run1, run2))
      res.json(payload)
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  app.get('/api/costs', async (req, res) => {
    try {
      const payload = await withClient(options, (client) =>
        client.costs(parseIntParam(req.query.last as string | undefined, 10)),
      )
      res.json(payload)
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  app.get('/api/query-visibility', async (_req, res) => {
    try {
      const payload = await withClient(options, (client) => client.dashboard.queryVisibility())
      res.json(payload)
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  app.get('/api/trends', async (req, res) => {
    try {
      const metric = (req.query.metric as string) ?? 'visibility_rate'
      const last = parseIntParam(req.query.last as string | undefined, 10)
      const payload = await withClient(options, (client) => client.dashboard.trends(metric, last))
      res.json(payload)
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  app.get('/api/runs/:id/competitors', async (req, res) => {
    try {
      const payload = await withClient(options, (client) => client.dashboard.competitors(req.params.id))
      res.json(payload)
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  app.get('/api/runs/:id/citations', async (req, res) => {
    try {
      const payload = await withClient(options, (client) => client.dashboard.citations(req.params.id))
      res.json(payload)
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  app.get('/api/runs/:id/recommendations', async (req, res) => {
    try {
      const payload = await withClient(options, (client) => client.dashboard.recommendations(req.params.id))
      if (!payload) {
        res.json({ error: 'No recommendations found for this run' })
        return
      }
      res.json(payload)
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  app.get('/api/audits', async (_req, res) => {
    try {
      const payload = await withClient(options, (client) => client.dashboard.audits())
      res.json(payload)
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  app.get('/api/audits/:id', async (req, res) => {
    try {
      const payload = await withClient(options, (client) => client.dashboard.audit(req.params.id))
      if (!payload) {
        res.status(404).json({ error: 'Audit not found' })
        return
      }
      res.json(payload)
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  const staticRoot = path.resolve(appRoot, 'dist/public')
  if (existsSync(staticRoot)) {
    app.use(express.static(staticRoot))
    app.get('*', (_req, res) => {
      res.sendFile(path.join(staticRoot, 'index.html'))
    })
  } else {
    app.get('*', (_req, res) => {
      res.type('html').send('<h1>Goose AEO Dashboard</h1><p>Run `npm run build --workspace goose-aeo-dashboard` to build UI assets.</p>')
    })
  }

  return new Promise<{ close: () => Promise<void> }>((resolve) => {
    const server = app.listen(port, () => {
      resolve({
        close: () =>
          new Promise<void>((done, reject) => {
            server.close((error) => {
              if (error) {
                reject(error)
                return
              }
              done()
            })
          }),
      })
    })
  })
}

const parseArg = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag)
  if (index < 0) {
    return undefined
  }

  return process.argv[index + 1]
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseIntParam(parseArg('--port'), 3847)
  const configPath = parseArg('--config')
  const pricingPath = parseArg('--pricing-config')
  const dataCwd = parseArg('--data-cwd')

  void startDashboardServer({ port, configPath, pricingPath, dataCwd }).then(() => {
    process.stdout.write(`Goose AEO dashboard listening on http://localhost:${port}\n`)
  })
}
