import { createAblyTokenRequest } from '../server/ablyToken.js'

// Vercel serverless function: GET /api/ably-token?room=CODE
export default async function handler(req, res) {
  try {
    const { status, body } = await createAblyTokenRequest(process.env.ABLY_API_KEY, req.query.room)
    res.setHeader('Cache-Control', 'no-store')
    res.status(status).json(body)
  } catch (err) {
    res.status(500).json({ error: 'Failed to create Ably token' })
  }
}
