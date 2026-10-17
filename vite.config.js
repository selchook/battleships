import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createAblyTokenRequest } from './server/ablyToken.js'

// Serves /api/ably-token during `npm run dev` so local dev works without `vercel dev`
const ablyTokenDevApi = (apiKey) => ({
  name: 'ably-token-dev-api',
  configureServer(server) {
    server.middlewares.use('/api/ably-token', async (req, res) => {
      const room = new URL(req.url, 'http://localhost').searchParams.get('room')
      let result
      try {
        result = await createAblyTokenRequest(apiKey, room)
      } catch {
        result = { status: 500, body: { error: 'Failed to create Ably token' } }
      }
      res.statusCode = result.status
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'no-store')
      res.end(JSON.stringify(result.body))
    })
  },
})

export default defineConfig(({ mode }) => {
  // Empty prefix loads non-VITE_ vars too; they stay server-side and are never bundled
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), ablyTokenDevApi(env.ABLY_API_KEY)],
  }
})
