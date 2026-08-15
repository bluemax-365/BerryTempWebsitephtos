import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createWriteStream } from 'node:fs'
import { mkdir, unlink, access, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const photosDir = path.join(__dirname, 'src', 'photos')
// Lives inside src/photos (not extension-matched by the gallery's image
// glob) so it rides on the same volume mount as the uploaded photos.
const tagsFile = path.join(photosDir, '.photo-tags.json')
const allowedExt = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'])

// Server-side tag store (keep/discard), shared by every client that hits
// this server — replaces the old per-browser localStorage approach.
let tagsCache = null

async function loadTags() {
  if (tagsCache) return tagsCache
  try {
    tagsCache = JSON.parse(await readFile(tagsFile, 'utf8'))
  } catch {
    tagsCache = {}
  }
  return tagsCache
}

async function saveTags() {
  await mkdir(photosDir, { recursive: true })
  await writeFile(tagsFile, JSON.stringify(tagsCache, null, 2))
}

// Rejects anything that isn't a plain filename with an allowed image
// extension, so requests can't escape the photos directory.
function safePhotoPath(rawName) {
  const name = path.basename(rawName || '')
  const ext = path.extname(name).toLowerCase()
  if (!name || name.startsWith('.') || !allowedExt.has(ext)) return null
  const full = path.join(photosDir, name)
  if (path.dirname(full) !== photosDir) return null
  return full
}

async function uniqueTarget(fullPath) {
  const ext = path.extname(fullPath)
  const base = fullPath.slice(0, -ext.length)
  let candidate = fullPath
  let i = 1
  while (true) {
    try {
      await access(candidate)
      candidate = `${base}-${i}${ext}`
      i += 1
    } catch {
      return candidate
    }
  }
}

// API for the gallery's upload/delete UI: writes and removes files
// directly in src/photos. Wired into both the dev and preview servers.
async function photoApiMiddleware(req, res, next) {
  const filename = decodeURIComponent(req.url.replace(/^\/+/, '').split('?')[0])

  if (req.method === 'PUT') {
    const target = safePhotoPath(filename)
    if (!target) {
      res.statusCode = 400
      res.end('Invalid filename')
      return
    }
    try {
      await mkdir(photosDir, { recursive: true })
      const finalTarget = await uniqueTarget(target)
      await new Promise((resolve, reject) => {
        const ws = createWriteStream(finalTarget)
        req.pipe(ws)
        req.on('error', reject)
        ws.on('error', reject)
        ws.on('finish', resolve)
      })
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ name: path.basename(finalTarget) }))
    } catch (err) {
      res.statusCode = 500
      res.end(String(err))
    }
    return
  }

  if (req.method === 'DELETE') {
    const target = safePhotoPath(filename)
    if (!target) {
      res.statusCode = 400
      res.end('Invalid filename')
      return
    }
    try {
      await unlink(target)
      const tags = await loadTags()
      if (tags[path.basename(target)]) {
        delete tags[path.basename(target)]
        await saveTags()
      }
      res.statusCode = 204
      res.end()
    } catch (err) {
      res.statusCode = err.code === 'ENOENT' ? 404 : 500
      res.end(String(err))
    }
    return
  }

  next()
}

// API for the gallery's keep/discard tags: reads and writes a single JSON
// file on the server, so tags persist across refreshes, browsers, and IPs.
async function tagsApiMiddleware(req, res, next) {
  const rawName = decodeURIComponent(req.url.replace(/^\/+/, '').split('?')[0])
  const name = rawName ? path.basename(rawName) : ''
  const tags = await loadTags()

  if (req.method === 'GET' && !name) {
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(tags))
    return
  }

  if (req.method === 'PUT' && name) {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', async () => {
      try {
        const { tag } = JSON.parse(body || '{}')
        if (tag === 'keep' || tag === 'discard') {
          tags[name] = tag
        } else {
          delete tags[name]
        }
        await saveTags()
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(tags))
      } catch (err) {
        res.statusCode = 400
        res.end(String(err))
      }
    })
    return
  }

  if (req.method === 'DELETE' && name) {
    delete tags[name]
    await saveTags()
    res.statusCode = 204
    res.end()
    return
  }

  next()
}

function photoLibraryPlugin() {
  return {
    name: 'photo-library-api',
    configureServer(server) {
      server.middlewares.use('/api/photos', photoApiMiddleware)
      server.middlewares.use('/api/tags', tagsApiMiddleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/photos', photoApiMiddleware)
      server.middlewares.use('/api/tags', tagsApiMiddleware)
    },
  }
}

const port = Number(process.env.PORT) || 5173

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), photoLibraryPlugin()],
  server: { host: true, port, allowedHosts: true },
  preview: { host: true, port, allowedHosts: true },
})
