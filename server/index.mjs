// SURVIVOR SMP game server - HTTP static hosting + WebSocket multiplayer.
// Single shared persistent world for ALL players. Zero npm dependencies.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { WorldRuntime } from '../src/shared/worldRuntime.js'
import { SNAPSHOT_HZ } from '../src/shared/constants.js'
import { GameServer } from './gameServer.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PORT = Number(process.env.PORT || 3000)
const DATA_DIR = path.join(ROOT, 'data')
const SAVE_PATH = path.join(DATA_DIR, 'world.json')
const LIVE_PREVIEW_DIR = process.env.RUNTIME_DIR || ''

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.map': 'text/plain',
}

// ------------------------------------------------------ persistence
function loadSave() {
  try {
    if (!fs.existsSync(SAVE_PATH)) return null
    const raw = fs.readFileSync(SAVE_PATH, 'utf8')
    return JSON.parse(raw)
  } catch (e) {
    // try the atomic temp backup
    try { return JSON.parse(fs.readFileSync(SAVE_PATH + '.bak', 'utf8')) } catch { return null }
  }
}

function saveAtomic(json, second = false) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const tmp = SAVE_PATH + '.tmp'
  fs.writeFileSync(tmp, json)
  try { if (fs.existsSync(SAVE_PATH)) fs.copyFileSync(SAVE_PATH, SAVE_PATH + '.bak') } catch {}
  fs.renameSync(tmp, SAVE_PATH)
}
// legacy one-arg helper for periodic saves
function saveWorld(json) { saveAtomic(json) }

// ------------------------------------------------------ world bootstrap
const existing = loadSave()
const hasSave = existing && existing.v === 3 && existing.seed != null
if (hasSave) console.log('[world] restoring saved shared world…')
const world = new WorldRuntime(hasSave ? existing.seed : 1708301)
if (hasSave && world.load(existing)) console.log('[world] restored:', Object.keys(existing.players || {}).length, 'players,', Object.values(existing.levels || {}).reduce((a, l) => a + (l.objects?.length || 0), 0), 'objects')
else console.log('[world] generating fresh shared world (seed', world.seed, ')')

// ------------------------------------------------------ live preview support (omgithub runtime)
let livePreviewScript = null
let watchProject = null
try {
  if (LIVE_PREVIEW_DIR) {
    const mod = await import(path.join(LIVE_PREVIEW_DIR, 'scripts', 'live-preview.mjs'))
    livePreviewScript = mod.livePreviewScript
    watchProject = mod.watchProject
  }
} catch { /* live reload unavailable – static fallback */ }

const clients = new Set()
let stopWatching = null
if (watchProject) stopWatching = watchProject(ROOT, () => { for (const c of clients) c.write('event: change\ndata: changed\n\n') })

// ------------------------------------------------------ game server
const game = new GameServer(world, {
  snapshotHz: SNAPSHOT_HZ,
  saveInterval: Number(process.env.SAVE_INTERVAL || 8),
  saveWorld,
  loadSave,
})

// ------------------------------------------------------ HTTP server
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/__omgithub/live') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' })
    res.write(': connected\n\n')
    clients.add(res)
    req.on('close', () => clients.delete(res))
    return
  }
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, players: world.online().length, day: world.time.day }))
    return
  }
  let p = url.pathname
  if (p === '/') p = '/index.html'
  p = decodeURIComponent(p)
  const file = path.join(ROOT, path.normalize(p))
  if (!file.startsWith(ROOT) || file === ROOT) { res.writeHead(404); res.end('Not found'); return }
  let stat = null
  try { stat = fs.statSync(file) } catch { /* fallthrough */ }
  const target = stat && stat.isDirectory() ? path.join(file, 'index.html') : file
  fs.readFile(target, (err, content) => {
    if (err) { res.writeHead(404); res.end('Not found'); return }
    res.setHeader('Content-Type', MIME[path.extname(target).toLowerCase()] || 'application/octet-stream')
    res.setHeader('Cache-Control', url.searchParams.has('omgithub_live') ? 'no-store' : 'no-cache')
    if (path.extname(target) === '.html' && url.searchParams.get('omgithub_live') === '1' && livePreviewScript) {
      const html = content.toString()
      res.end(/<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, `${livePreviewScript}</body>`) : html + livePreviewScript)
    } else res.end(content)
  })
})

// ------------------------------------------------------ WebSocket upgrade
const HANDSHAKE_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key']
  if (!key || game.pathOk(req.url) === false) { socket.destroy(); return }
  socket.setNoDelay(true)
  const accept = crypto.createHash('sha1').update(key + HANDSHAKE_GUID).digest('base64')
  const reqProto = (req.headers['sec-websocket-protocol'] || '').split(',')[0].trim()
  let extra = ''
  if (reqProto) extra = `Sec-WebSocket-Protocol: ${reqProto}\r\n`
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    extra +
    '\r\n',
  )
  game.attachClient(socket)
})

setInterval(() => {
  for (const c of game.clients.values()) {
    try { c.sendPing() } catch {}
  }
}, 25000)

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] SURVIVOR SMP online at http://0.0.0.0:${PORT} (day ${world.time.day}, ${world.online().length} players online)`)
  if (process.env.OPENCODE_WEB_DIR) {
    try {
      fs.writeFileSync(path.join(process.env.OPENCODE_WEB_DIR, 'deployment-output.json'), JSON.stringify({ project: ROOT, directory: ROOT }))
      console.log('[server] deployment-output.json written')
    } catch {}
  }
})
const shutdown = () => {
  try { game.saveNow() } catch {}
  try { if (stopWatching) stopWatching() } catch {}
  for (const c of game.clients.values()) try { c.socket.end() } catch {}
  setTimeout(() => process.exit(0), 150)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('uncaughtException', (e) => { console.error('[server] uncaught', e) })
