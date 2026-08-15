import { useEffect, useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'

const photoModules = import.meta.glob('./photos/*.{png,jpg,jpeg,webp,gif,svg,PNG,JPG,JPEG,WEBP,GIF,SVG}', {
  eager: true,
  import: 'default',
})

const photos = Object.entries(photoModules)
  .map(([path, url]) => ({
    id: path,
    name: path.split('/').pop(),
    url,
  }))
  .sort((a, b) => a.name.localeCompare(b.name))

const STORAGE_KEY = 'gallery-tags'

function loadTags() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}
  } catch {
    return {}
  }
}

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'unset', label: 'Untagged' },
  { id: 'keep', label: 'Keep' },
  { id: 'discard', label: 'Discard' },
]

function PhotoCard({ photo, tag, onTag, onDelete, onOpen }) {
  return (
    <div className="glass group flex flex-col overflow-hidden rounded-2xl transition-transform duration-300 hover:-translate-y-1">
      <div className="relative aspect-square overflow-hidden bg-black/30">
        <img
          src={photo.url}
          alt={photo.name}
          loading="lazy"
          onClick={() => onOpen(photo)}
          className="h-full w-full cursor-zoom-in object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <button
          type="button"
          onClick={() => onDelete(photo)}
          title="Delete photo"
          aria-label={`Delete ${photo.name}`}
          className="absolute left-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white/80 opacity-0 backdrop-blur-md transition-opacity hover:bg-rose-500/80 hover:text-white group-hover:opacity-100"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z" />
          </svg>
        </button>
        {tag && (
          <span
            className={`absolute right-2 top-2 rounded-full px-2.5 py-1 text-xs font-medium backdrop-blur-md ${
              tag === 'keep'
                ? 'bg-emerald-400/20 text-emerald-300 ring-1 ring-emerald-300/40'
                : 'bg-rose-400/20 text-rose-300 ring-1 ring-rose-300/40'
            }`}
          >
            {tag === 'keep' ? 'Keep' : 'Discard'}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="truncate text-xs text-white/50" title={photo.name}>
          {photo.name}
        </p>

        <div className="mt-auto flex gap-2">
          <button
            type="button"
            onClick={() => onTag(photo.id, tag === 'keep' ? null : 'keep')}
            className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
              tag === 'keep'
                ? 'bg-emerald-400/90 text-emerald-950'
                : 'glass hover:bg-emerald-400/15 hover:text-emerald-300'
            }`}
          >
            Keep
          </button>
          <button
            type="button"
            onClick={() => onTag(photo.id, tag === 'discard' ? null : 'discard')}
            className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
              tag === 'discard'
                ? 'bg-rose-400/90 text-rose-950'
                : 'glass hover:bg-rose-400/15 hover:text-rose-300'
            }`}
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  )
}

function Lightbox({ photo, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="glass absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full text-white/80 hover:text-white"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
      <img
        src={photo.url}
        alt={photo.name}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
      />
      <p className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/40 px-3 py-1 text-sm text-white/70 backdrop-blur-md">
        {photo.name}
      </p>
    </div>
  )
}

export default function App() {
  const [tags, setTags] = useState(loadTags)
  const [lightboxPhoto, setLightboxPhoto] = useState(null)
  const [filter, setFilter] = useState('all')
  const [uploading, setUploading] = useState(0)
  const [zipping, setZipping] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef(null)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tags))
  }, [tags])

  const setTag = (id, value) => {
    setTags((prev) => {
      const next = { ...prev }
      if (value) next[id] = value
      else delete next[id]
      return next
    })
  }

  const handleUpload = async (event) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return

    setError('')
    setUploading((n) => n + files.length)
    for (const file of files) {
      try {
        const res = await fetch(`/api/photos/${encodeURIComponent(file.name)}`, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        })
        if (!res.ok) throw new Error(await res.text())
      } catch (err) {
        setError(`Failed to upload ${file.name}: ${err.message}`)
      } finally {
        setUploading((n) => n - 1)
      }
    }
  }

  const handleDelete = async (photo) => {
    if (!window.confirm(`Delete ${photo.name}? This can't be undone.`)) return

    setError('')
    try {
      const res = await fetch(`/api/photos/${encodeURIComponent(photo.name)}`, {
        method: 'DELETE',
      })
      if (!res.ok && res.status !== 404) throw new Error(await res.text())
      setTag(photo.id, null)
    } catch (err) {
      setError(`Failed to delete ${photo.name}: ${err.message}`)
    }
  }

  const handleDownloadKeep = async () => {
    const kept = photos.filter((p) => tags[p.id] === 'keep')
    if (kept.length === 0) return

    setError('')
    setZipping(true)
    try {
      const zip = new JSZip()
      for (const photo of kept) {
        const res = await fetch(photo.url)
        if (!res.ok) throw new Error(`Failed to fetch ${photo.name}`)
        zip.file(photo.name, await res.blob())
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'keep-photos.zip'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(`Failed to build zip: ${err.message}`)
    } finally {
      setZipping(false)
    }
  }

  const counts = useMemo(() => {
    const c = { keep: 0, discard: 0 }
    for (const v of Object.values(tags)) c[v] = (c[v] ?? 0) + 1
    return { ...c, unset: photos.length - c.keep - c.discard }
  }, [tags])

  const visible = useMemo(() => {
    if (filter === 'all') return photos
    if (filter === 'unset') return photos.filter((p) => !tags[p.id])
    return photos.filter((p) => tags[p.id] === filter)
  }, [filter, tags])

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="bg-blob h-128 w-lg -left-40 -top-40 bg-violet-600" />
      <div className="bg-blob h-112 w-md -right-40 top-1/3 bg-cyan-500" />
      <div className="bg-blob h-96 w-96 -bottom-32 left-1/3 bg-fuchsia-600" />

      <div className="relative z-10 mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="glass-strong sticky top-4 z-20 mb-8 rounded-2xl px-5 py-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Photo Gallery</h1>
              <p className="text-sm text-white/50">
                {photos.length} photo{photos.length === 1 ? '' : 's'} &middot;{' '}
                <span className="text-emerald-300">{counts.keep} kept</span>
                {' · '}
                <span className="text-rose-300">{counts.discard} discarded</span>
                {' · '}
                <span className="text-white/50">{counts.unset} untagged</span>
              </p>
            </div>

            <nav className="flex flex-wrap items-center gap-2">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    filter === f.id
                      ? 'bg-white/90 text-black'
                      : 'glass text-white/70 hover:text-white'
                  }`}
                >
                  {f.label}
                </button>
              ))}

              <span className="mx-1 h-5 w-px bg-white/15" />

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading > 0}
                className="rounded-full bg-white/90 px-4 py-1.5 text-sm font-medium text-black transition-colors hover:bg-white disabled:opacity-50"
              >
                {uploading > 0 ? `Uploading ${uploading}…` : 'Upload'}
              </button>
              <button
                type="button"
                onClick={handleDownloadKeep}
                disabled={zipping || counts.keep === 0}
                className="rounded-full bg-emerald-400/90 px-4 py-1.5 text-sm font-medium text-emerald-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
              >
                {zipping ? 'Zipping…' : `Download Keep (${counts.keep})`}
              </button>
            </nav>
          </div>

          {error && (
            <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300 ring-1 ring-rose-400/30">
              {error}
            </p>
          )}
        </header>

        {photos.length === 0 ? (
          <div className="glass mx-auto mt-24 max-w-md rounded-2xl p-8 text-center">
            <p className="text-lg font-medium">No photos found</p>
            <p className="mt-2 text-sm text-white/50">
              Use the Upload button above, or drop images into{' '}
              <code className="text-white/70">src/photos</code> directly.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <div className="glass mx-auto mt-24 max-w-md rounded-2xl p-8 text-center">
            <p className="text-lg font-medium">Nothing to show</p>
            <p className="mt-2 text-sm text-white/50">No photos match this filter yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map((photo) => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                tag={tags[photo.id]}
                onTag={setTag}
                onDelete={handleDelete}
                onOpen={setLightboxPhoto}
              />
            ))}
          </div>
        )}
      </div>

      {lightboxPhoto && <Lightbox photo={lightboxPhoto} onClose={() => setLightboxPhoto(null)} />}
    </div>
  )
}
