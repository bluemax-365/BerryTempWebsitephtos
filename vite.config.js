import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createWriteStream } from 'node:fs'
import { mkdir, unlink, access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const photosDir = path.join(__dirname, 'src', 'photos')
const allowedExt = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'])

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

function photoLibraryPlugin() {
  return {
    name: 'photo-library-api',
    configureServer(server) {
      server.middlewares.use('/api/photos', photoApiMiddleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/photos', photoApiMiddleware)
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
