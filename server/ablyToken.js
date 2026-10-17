import * as Ably from 'ably'

// Room codes are short uppercase alphanumerics (e.g. "NS4K2P")
const ROOM_RE = /^[A-Z0-9]{2,12}$/

// Issues a signed Ably token request scoped to a single game channel.
// The API key never leaves the server; clients only receive a short-lived token.
export async function createAblyTokenRequest(apiKey, room) {
  if (!apiKey) return { status: 500, body: { error: 'ABLY_API_KEY is not configured' } }

  const code = String(room || '').toUpperCase()
  if (!ROOM_RE.test(code)) return { status: 400, body: { error: 'Invalid room code' } }

  const rest = new Ably.Rest({ key: apiKey })
  const tokenRequest = await rest.auth.createTokenRequest({
    clientId: `player-${Math.random().toString(36).slice(2, 10)}`,
    capability: JSON.stringify({ [`bship-${code}`]: ['publish', 'subscribe'] }),
    ttl: 60 * 60 * 1000, // 1 hour; the SDK re-requests automatically when it expires
  })
  return { status: 200, body: tokenRequest }
}
