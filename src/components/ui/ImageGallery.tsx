import { useEffect, useMemo, useRef, useState } from 'react'
import { X, ChevronLeft, ChevronRight, Download, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'
import { ItemImage } from '@/types'

interface ImageGalleryProps {
  images: ItemImage[]
  initialIndex?: number
  onClose: () => void
}

export default function ImageGallery({ images, initialIndex = 0, onClose }: ImageGalleryProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [isLoaded, setIsLoaded] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)
  const [uiVisible, setUiVisible] = useState(true)
  const imageContainerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const hideUiTimerRef = useRef<number | null>(null)
  const zoomRef = useRef(zoom)
  const panXRef = useRef(panX)
  const panYRef = useRef(panY)
  const suppressClickRef = useRef(false)
  const pointerStartRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null)

  type GestureState =
    | {
        kind: 'pan'
        pointerId: number
        startClientX: number
        startClientY: number
        startPanX: number
        startPanY: number
      }
    | {
        kind: 'pinch'
        pointerIdA: number
        pointerIdB: number
        startDistance: number
        startZoom: number
        startPanX: number
        startPanY: number
        containerCenterX: number
        containerCenterY: number
        startPinchCenterX: number
        startPinchCenterY: number
      }

  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const gestureRef = useRef<GestureState | null>(null)

  const currentImage = images[currentIndex]

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

  const getContainerRect = (): DOMRect | null => imageContainerRef.current?.getBoundingClientRect() ?? null

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return (bytes / Math.pow(k, i)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + sizes[i]
  }

  const getBaseImageSize = (): { width: number; height: number } | null => {
    const rect = imageRef.current?.getBoundingClientRect()
    if (!rect) return null
    // rect includes transform; divide out zoom to get base (zoom=1) size.
    const baseWidth = rect.width / Math.max(zoomRef.current, 0.0001)
    const baseHeight = rect.height / Math.max(zoomRef.current, 0.0001)
    if (!Number.isFinite(baseWidth) || !Number.isFinite(baseHeight) || baseWidth <= 0 || baseHeight <= 0) return null
    return { width: baseWidth, height: baseHeight }
  }

  const clampPanToBounds = (nextPanX: number, nextPanY: number, nextZoom: number): { x: number; y: number } => {
    const container = getContainerRect()
    const base = getBaseImageSize()
    if (!container || !base) return { x: nextPanX, y: nextPanY }

    const scaledW = base.width * nextZoom
    const scaledH = base.height * nextZoom

    const maxX = Math.max(0, (scaledW - container.width) / 2)
    const maxY = Math.max(0, (scaledH - container.height) / 2)

    return {
      x: clamp(nextPanX, -maxX, maxX),
      y: clamp(nextPanY, -maxY, maxY)
    }
  }

  const showUi = () => {
    setUiVisible(true)
    if (hideUiTimerRef.current) window.clearTimeout(hideUiTimerRef.current)
    hideUiTimerRef.current = window.setTimeout(() => {
      // Keep UI visible while zoomed in, otherwise it becomes frustrating to find controls.
      if (zoomRef.current <= 1.01) setUiVisible(false)
    }, 2200)
  }

  const resetView = () => {
    setZoom(1)
    setPanX(0)
    setPanY(0)
  }

  const setZoomAroundPoint = (nextZoom: number, clientX: number, clientY: number) => {
    const container = getContainerRect()
    if (!container) {
      setZoom(nextZoom)
      if (nextZoom === 1) {
        setPanX(0)
        setPanY(0)
      }
      return
    }

    const containerCenterX = container.left + container.width / 2
    const containerCenterY = container.top + container.height / 2

    // Keep the content under the cursor stable while zooming.
    const dx = (clientX - containerCenterX - panXRef.current) / Math.max(zoomRef.current, 0.0001)
    const dy = (clientY - containerCenterY - panYRef.current) / Math.max(zoomRef.current, 0.0001)

    const unclampedPanX = clientX - containerCenterX - dx * nextZoom
    const unclampedPanY = clientY - containerCenterY - dy * nextZoom
    const clamped = clampPanToBounds(unclampedPanX, unclampedPanY, nextZoom)

    setZoom(nextZoom)
    setPanX(clamped.x)
    setPanY(clamped.y)
  }

  const zoomToCenter = (nextZoom: number) => {
    const container = getContainerRect()
    if (!container) {
      setZoom(nextZoom)
      if (nextZoom === 1) {
        setPanX(0)
        setPanY(0)
      }
      return
    }
    setZoomAroundPoint(nextZoom, container.left + container.width / 2, container.top + container.height / 2)
  }

  // Reset zoom and pan when image changes
  useEffect(() => {
    resetView()
  }, [currentIndex])

  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  useEffect(() => {
    panXRef.current = panX
    panYRef.current = panY
  }, [panX, panY])

  // Auto-hide UI when first opened (unless user is already zoomed)
  useEffect(() => {
    showUi()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      if (hideUiTimerRef.current) window.clearTimeout(hideUiTimerRef.current)
    }
  }, [])

  const zoomStep = 0.5
  const minZoom = 1
  const maxZoom = 5

  const handleZoomIn = () => {
    showUi()
    zoomToCenter(clamp(zoomRef.current + zoomStep, minZoom, maxZoom))
  }

  const handleZoomOut = () => {
    showUi()
    const nextZoom = clamp(zoomRef.current - zoomStep, minZoom, maxZoom)
    if (nextZoom === 1) {
      resetView()
      return
    }
    zoomToCenter(nextZoom)
  }

  const handleResetZoom = () => {
    showUi()
    resetView()
  }

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      showUi()

      // If zoomed, allow panning with arrow keys
      if (zoom > 1.01) {
        switch (e.key) {
          case 'ArrowLeft':
            e.preventDefault()
            setPanX(prev => clampPanToBounds(prev + 50, panY, zoom).x)
            return
          case 'ArrowRight':
            e.preventDefault()
            setPanX(prev => clampPanToBounds(prev - 50, panY, zoom).x)
            return
          case 'ArrowUp':
            e.preventDefault()
            setPanY(prev => clampPanToBounds(panX, prev + 50, zoom).y)
            return
          case 'ArrowDown':
            e.preventDefault()
            setPanY(prev => clampPanToBounds(panX, prev - 50, zoom).y)
            return
        }
      }

      switch (e.key) {
        case 'Escape':
          if (zoom > 1.01) {
            // Reset zoom first
            handleResetZoom()
          } else {
            onClose()
          }
          break
        case 'ArrowLeft':
          e.preventDefault()
          setCurrentIndex(prev => (prev > 0 ? prev - 1 : images.length - 1))
          break
        case 'ArrowRight':
          e.preventDefault()
          setCurrentIndex(prev => (prev < images.length - 1 ? prev + 1 : 0))
          break
        case '+':
        case '=':
          e.preventDefault()
          handleZoomIn()
          break
        case '-':
        case '_':
          e.preventDefault()
          handleZoomOut()
          break
        case '0':
          e.preventDefault()
          handleResetZoom()
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, images.length, zoom, panX, panY])

  // Prevent body scroll when gallery is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [])

  // Use a non-passive wheel listener so preventDefault works (avoids Chrome warnings).
  useEffect(() => {
    const el = imageContainerRef.current
    if (!el) return

    const onWheel = (event: WheelEvent) => {
      // Prevent the page from scrolling/zooming behind the modal.
      event.preventDefault()
      showUi()

      const delta = event.deltaY > 0 ? -0.2 : 0.2
      const nextZoom = clamp(zoomRef.current + delta, minZoom, maxZoom)
      if (Math.abs(nextZoom - zoomRef.current) < 0.0001) return
      setZoomAroundPoint(nextZoom, event.clientX, event.clientY)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel as EventListener)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handlePrevious = () => {
    setCurrentIndex(prev => (prev > 0 ? prev - 1 : images.length - 1))
    setIsLoaded(false)
  }

  const handleNext = () => {
    setCurrentIndex(prev => (prev < images.length - 1 ? prev + 1 : 0))
    setIsLoaded(false)
  }

  const beginPanGesture = (pointerId: number, clientX: number, clientY: number) => {
    gestureRef.current = {
      kind: 'pan',
      pointerId,
      startClientX: clientX,
      startClientY: clientY,
      startPanX: panXRef.current,
      startPanY: panYRef.current
    }
  }

  const tryBeginPinchGesture = () => {
    const entries = Array.from(pointersRef.current.entries())
    if (entries.length < 2) return
    const [a, b] = entries.slice(0, 2)
    const pointerIdA = a[0]
    const pointerIdB = b[0]
    const ax = a[1].x
    const ay = a[1].y
    const bx = b[1].x
    const by = b[1].y

    const container = getContainerRect()
    if (!container) return

    const startDistance = Math.hypot(bx - ax, by - ay)
    const startPinchCenterX = (ax + bx) / 2
    const startPinchCenterY = (ay + by) / 2

    gestureRef.current = {
      kind: 'pinch',
      pointerIdA,
      pointerIdB,
      startDistance: Math.max(startDistance, 0.0001),
      startZoom: zoom,
      startPanX: panX,
      startPanY: panY,
      containerCenterX: container.left + container.width / 2,
      containerCenterY: container.top + container.height / 2,
      startPinchCenterX,
      startPinchCenterY
    }
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    // Track all pointers (mouse, touch, pen).
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    pointerStartRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    showUi()

    // Capture so we keep receiving events even if the pointer leaves the element.
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }

    // If zoomed in, start panning immediately on first pointer.
    if (pointersRef.current.size === 1 && zoom > 1.01) {
      beginPanGesture(e.pointerId, e.clientX, e.clientY)
    }

    // If there are 2 pointers, begin a pinch gesture.
    if (pointersRef.current.size >= 2) {
      tryBeginPinchGesture()
    }
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pointersRef.current.has(e.pointerId)) return
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    const start = pointerStartRef.current.get(e.pointerId)
    if (start) {
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y)
      if (moved > 6) suppressClickRef.current = true
    }

    const g = gestureRef.current
    if (!g) return

    if (g.kind === 'pan') {
      if (e.pointerId !== g.pointerId) return
      if (zoom <= 1.01) return
      e.preventDefault()

      const dx = e.clientX - g.startClientX
      const dy = e.clientY - g.startClientY
      const unclampedX = g.startPanX + dx
      const unclampedY = g.startPanY + dy
      const clamped = clampPanToBounds(unclampedX, unclampedY, zoom)
      setPanX(clamped.x)
      setPanY(clamped.y)
      return
    }

    // Pinch
    const a = pointersRef.current.get(g.pointerIdA)
    const b = pointersRef.current.get(g.pointerIdB)
    if (!a || !b) return

    e.preventDefault()

    const currentDistance = Math.hypot(b.x - a.x, b.y - a.y)
    const pinchScale = currentDistance / Math.max(g.startDistance, 0.0001)
    const nextZoom = clamp(g.startZoom * pinchScale, minZoom, maxZoom)

    const currentCenterX = (a.x + b.x) / 2
    const currentCenterY = (a.y + b.y) / 2

    // Maintain the content under the pinch center.
    const startDx = (g.startPinchCenterX - g.containerCenterX - g.startPanX) / Math.max(g.startZoom, 0.0001)
    const startDy = (g.startPinchCenterY - g.containerCenterY - g.startPanY) / Math.max(g.startZoom, 0.0001)

    const unclampedPanX = currentCenterX - g.containerCenterX - startDx * nextZoom
    const unclampedPanY = currentCenterY - g.containerCenterY - startDy * nextZoom
    const clamped = clampPanToBounds(unclampedPanX, unclampedPanY, nextZoom)

    setZoom(nextZoom)
    setPanX(clamped.x)
    setPanY(clamped.y)
  }

  const handlePointerUpOrCancel = (e: React.PointerEvent) => {
    const pointerStart = pointerStartRef.current.get(e.pointerId)
    pointersRef.current.delete(e.pointerId)
    pointerStartRef.current.delete(e.pointerId)
    if (pointersRef.current.size < 2 && gestureRef.current?.kind === 'pinch') {
      gestureRef.current = null
    }
    if (pointersRef.current.size === 0 && gestureRef.current?.kind === 'pan') {
      gestureRef.current = null
    }

    // If one pointer remains and we're zoomed, convert to pan.
    if (pointersRef.current.size === 1 && zoom > 1.01) {
      const [only] = Array.from(pointersRef.current.entries())
      beginPanGesture(only[0], only[1].x, only[1].y)
    }

    // Double-tap (touch) toggles zoom at tap point.
    if (e.pointerType === 'touch' && pointersRef.current.size === 0) {
      const now = Date.now()
      const prev = lastTapRef.current
      const start = { x: e.clientX, y: e.clientY }

      if (prev && now - prev.t < 320 && Math.hypot(start.x - prev.x, start.y - prev.y) < 26) {
        // Prevent the subsequent click from toggling UI.
        suppressClickRef.current = true
        lastTapRef.current = null
        showUi()
        if (zoomRef.current > 1.01) {
          resetView()
        } else {
          setZoomAroundPoint(2, e.clientX, e.clientY)
        }
        return
      }

      // Only record as a "tap" if the pointer didn't move much (avoid treating drags as taps).
      if (!pointerStart || Math.hypot(start.x - pointerStart.x, start.y - pointerStart.y) < 10) {
        lastTapRef.current = { t: now, x: start.x, y: start.y }
      }
    }
  }

  const handleDoubleClick = (e: React.MouseEvent) => {
    // Double click toggles zoom (centered on cursor).
    e.preventDefault()
    showUi()
    if (zoom > 1.01) {
      resetView()
      return
    }
    setZoomAroundPoint(2, e.clientX, e.clientY)
  }

  const isZoomed = zoom > 1.01
  const isMultiImage = images.length > 1

  const fileSizeLabel = useMemo(() => formatFileSize(currentImage?.size || 0), [currentImage?.size])

  return (
    <div
      className="fixed inset-0 z-50 bg-black bg-opacity-90"
      onMouseMove={showUi}
      onTouchStart={showUi}
      onClick={() => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false
          // First tap after a drag/pinch should bring controls back.
          setUiVisible(true)
          showUi()
          return
        }
        setUiVisible(v => {
          const next = !v
          if (next) showUi()
          return next
        })
      }}
      aria-modal="true"
      role="dialog"
    >
      <div className="w-full h-full flex flex-col">
        {/* Close button should ALWAYS be accessible */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          className={`absolute top-4 right-4 z-30 p-2 text-white hover:text-gray-300 transition-colors ${
            uiVisible ? '' : 'opacity-90 bg-black/40 rounded-full'
          }`}
          aria-label="Close gallery"
          title="Close (Esc)"
        >
          <X className="h-6 w-6" />
        </button>

        {/* Top overlay controls */}
        {uiVisible && (
          <>

            {isMultiImage && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handlePrevious()
                  }}
                  className="absolute left-4 top-1/2 transform -translate-y-1/2 z-20 p-2 text-white hover:text-gray-300 transition-colors"
                  aria-label="Previous image"
                >
                  <ChevronLeft className="h-8 w-8" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleNext()
                  }}
                  className="absolute right-4 top-1/2 transform -translate-y-1/2 z-20 p-2 text-white hover:text-gray-300 transition-colors"
                  aria-label="Next image"
                >
                  <ChevronRight className="h-8 w-8" />
                </button>
              </>
            )}

            <div className="absolute top-4 left-4 z-20 flex flex-col gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleZoomIn()
                }}
                className="p-2 bg-black bg-opacity-50 text-white hover:bg-opacity-70 transition-colors rounded"
                aria-label="Zoom in"
                title="Zoom in (+)"
              >
                <ZoomIn className="h-5 w-5" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleZoomOut()
                }}
                disabled={zoom <= 1.01}
                className="p-2 bg-black bg-opacity-50 text-white hover:bg-opacity-70 transition-colors rounded disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Zoom out"
                title="Zoom out (-)"
              >
                <ZoomOut className="h-5 w-5" />
              </button>
              {isZoomed && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleResetZoom()
                  }}
                  className="p-2 bg-black bg-opacity-50 text-white hover:bg-opacity-70 transition-colors rounded"
                  aria-label="Reset zoom"
                  title="Reset zoom (0)"
                >
                  <RotateCcw className="h-5 w-5" />
                </button>
              )}
            </div>
          </>
        )}

        {/* Main image container (flexes) */}
        <div className="flex-1 min-h-0 p-4 flex items-center justify-center">
          <div
            ref={imageContainerRef}
            className="relative w-full h-full flex items-center justify-center overflow-hidden"
            style={{ touchAction: 'none' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUpOrCancel}
            onPointerCancel={handlePointerUpOrCancel}
            onDoubleClick={handleDoubleClick}
          >
            <img
              ref={imageRef}
              src={currentImage.url}
              alt={currentImage.alt || currentImage.fileName}
              className="max-w-full max-h-full object-contain select-none"
              onLoad={() => setIsLoaded(true)}
              style={{
                opacity: isLoaded ? 1 : 0,
                transition: zoom === 1 ? 'opacity 0.3s ease' : 'none',
                transform: `translate3d(${panX}px, ${panY}px, 0) scale(${zoom})`,
                transformOrigin: 'center center',
                cursor: isZoomed ? 'grab' : 'default'
              }}
              draggable={false}
            />

            {!isLoaded && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
              </div>
            )}
          </div>
        </div>

        {/* Bottom info bar (in layout, never covers the image) */}
        {uiVisible && (
          <div
            className="shrink-0 bg-black bg-opacity-70 text-white px-4 py-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-medium truncate">
                  {currentImage.alt || currentImage.fileName}
                </h3>
                {currentImage.caption && (
                  <p className="text-xs text-gray-300 mt-1">{currentImage.caption}</p>
                )}
                <div className="flex items-center space-x-4 mt-1 text-xs text-gray-400">
                  <span>{currentIndex + 1} of {images.length}</span>
                  <span>{fileSizeLabel}</span>
                  <span>
                    {(() => {
                      try {
                        return new Date(currentImage.uploadedAt).toLocaleDateString()
                      } catch (error) {
                        console.warn('Invalid date for image:', currentImage.uploadedAt, error)
                        return 'Unknown date'
                      }
                    })()}
                  </span>
                </div>
              </div>

              {isMultiImage && (
                <div className="hidden sm:flex items-center space-x-2">
                  {images.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => {
                        setCurrentIndex(index)
                        setIsLoaded(false)
                      }}
                      className={`w-2 h-2 rounded-full transition-colors ${
                        index === currentIndex ? 'bg-white' : 'bg-white bg-opacity-50'
                      }`}
                      aria-label={`Go to image ${index + 1}`}
                    />
                  ))}
                </div>
              )}

              <button
                onClick={() => window.open(currentImage.url, '_blank')}
                className="p-2 text-white hover:text-gray-300 transition-colors"
                aria-label="Download image"
                title="Open image in new tab"
              >
                <Download className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
