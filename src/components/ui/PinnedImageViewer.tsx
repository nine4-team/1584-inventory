import { useState, useRef, useEffect, useCallback } from 'react'
import { X, ZoomIn, ZoomOut, RotateCcw, ChevronLeft, ChevronRight, GripVertical } from 'lucide-react'
import { ItemImage, TransactionImage } from '@/types'

interface PinnedImageViewerProps {
  images: (ItemImage | TransactionImage)[]
  position: { x: number; y: number }
  size: { width: number; height: number }
  onPositionChange: (position: { x: number; y: number }) => void
  onSizeChange: (size: { width: number; height: number }) => void
  onClose: () => void
  initialIndex?: number
}

export default function PinnedImageViewer({
  images,
  position,
  size,
  onPositionChange,
  onSizeChange,
  onClose,
  initialIndex = 0
}: PinnedImageViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [zoom, setZoom] = useState(1)
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const [resizeHandle, setResizeHandle] = useState<string | null>(null)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)

  const minZoom = 1
  const maxZoom = 5
  const minSize = { width: 300, height: 200 }
  const maxSize = { width: window.innerWidth - 40, height: window.innerHeight - 40 }

  // Handle window dragging
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only start drag if clicking on the header area
    const target = e.target as HTMLElement
    if (target.closest('.pinned-header') || target.closest('.drag-handle')) {
      setIsDragging(true)
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y })
      e.preventDefault()
    }
  }, [position])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging) {
      const newX = e.clientX - dragStart.x
      const newY = e.clientY - dragStart.y
      // Keep window within viewport
      const constrainedX = Math.max(0, Math.min(newX, window.innerWidth - size.width))
      const constrainedY = Math.max(0, Math.min(newY, window.innerHeight - size.height))
      onPositionChange({ x: constrainedX, y: constrainedY })
    } else if (isResizing && resizeHandle) {
      const deltaX = e.clientX - dragStart.x
      const deltaY = e.clientY - dragStart.y
      
      let newWidth = size.width
      let newHeight = size.height
      let newX = position.x
      let newY = position.y

      if (resizeHandle.includes('right')) {
        newWidth = Math.max(minSize.width, Math.min(size.width + deltaX, maxSize.width))
      }
      if (resizeHandle.includes('left')) {
        const widthChange = size.width - Math.max(minSize.width, Math.min(size.width - deltaX, maxSize.width))
        newWidth = size.width - widthChange
        newX = position.x + widthChange
      }
      if (resizeHandle.includes('bottom')) {
        newHeight = Math.max(minSize.height, Math.min(size.height + deltaY, maxSize.height))
      }
      if (resizeHandle.includes('top')) {
        const heightChange = size.height - Math.max(minSize.height, Math.min(size.height - deltaY, maxSize.height))
        newHeight = size.height - heightChange
        newY = position.y + heightChange
      }

      // Keep within viewport
      newX = Math.max(0, Math.min(newX, window.innerWidth - newWidth))
      newY = Math.max(0, Math.min(newY, window.innerHeight - newHeight))

      onSizeChange({ width: newWidth, height: newHeight })
      onPositionChange({ x: newX, y: newY })
      setDragStart({ x: e.clientX, y: e.clientY })
    }
  }, [isDragging, isResizing, resizeHandle, dragStart, position, size, onPositionChange, onSizeChange])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
    setIsResizing(false)
    setResizeHandle(null)
  }, [])

  useEffect(() => {
    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, isResizing, handleMouseMove, handleMouseUp])

  const handleResizeStart = (e: React.MouseEvent, handle: string) => {
    e.stopPropagation()
    setIsResizing(true)
    setResizeHandle(handle)
    setDragStart({ x: e.clientX, y: e.clientY })
  }

  const handleZoomIn = () => setZoom(prev => Math.min(prev * 1.2, maxZoom))
  const handleZoomOut = () => setZoom(prev => Math.max(prev / 1.2, minZoom))
  const handleResetZoom = () => {
    setZoom(1)
    setPanX(0)
    setPanY(0)
  }

  const handlePrevious = () => {
    setCurrentIndex(prev => prev > 0 ? prev - 1 : images.length - 1)
    setZoom(1)
    setPanX(0)
    setPanY(0)
  }

  const handleNext = () => {
    setCurrentIndex(prev => prev < images.length - 1 ? prev + 1 : 0)
    setZoom(1)
    setPanX(0)
    setPanY(0)
  }

  if (images.length === 0) return null

  const currentImage = images[currentIndex]

  return (
    <div
      ref={containerRef}
      className="fixed z-50 bg-white border-2 border-gray-300 rounded-lg shadow-2xl flex flex-col"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${size.width}px`,
        height: `${size.height}px`,
        cursor: isDragging ? 'grabbing' : 'default'
      }}
    >
      {/* Header - draggable */}
      <div
        className="pinned-header flex items-center justify-between bg-gray-100 border-b border-gray-300 px-3 py-2 cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <GripVertical className="h-4 w-4 text-gray-500 drag-handle" />
          <span className="text-sm font-medium text-gray-700 truncate">
            Pinned Receipt {images.length > 1 && `(${currentIndex + 1}/${images.length})`}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {images.length > 1 && (
            <>
              <button
                onClick={handlePrevious}
                className="p-1 hover:bg-gray-200 rounded transition-colors"
                title="Previous image"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={handleNext}
                className="p-1 hover:bg-gray-200 rounded transition-colors"
                title="Next image"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          )}
          <button
            onClick={onClose}
            className="p-1 hover:bg-red-100 rounded transition-colors"
            title="Close"
          >
            <X className="h-4 w-4 text-gray-700" />
          </button>
        </div>
      </div>

      {/* Controls bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center gap-1">
          <button
            onClick={handleZoomIn}
            className="p-1.5 hover:bg-gray-200 rounded transition-colors"
            title="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            onClick={handleZoomOut}
            disabled={zoom <= minZoom}
            className="p-1.5 hover:bg-gray-200 rounded transition-colors disabled:opacity-50"
            title="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          {zoom > minZoom && (
            <button
              onClick={handleResetZoom}
              className="p-1.5 hover:bg-gray-200 rounded transition-colors"
              title="Reset zoom"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
        </div>
        <span className="text-xs text-gray-500">{Math.round(zoom * 100)}%</span>
      </div>

      {/* Image container */}
      <div
        className="flex-1 overflow-hidden bg-gray-50 relative"
        style={{ touchAction: 'none' }}
      >
        <div
          className="w-full h-full flex items-center justify-center"
          style={{
            transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
            transformOrigin: 'center center'
          }}
        >
          <img
            ref={imageRef}
            src={currentImage.url}
            alt={currentImage.fileName || `Image ${currentIndex + 1}`}
            className="max-w-full max-h-full object-contain select-none"
            draggable={false}
            onMouseDown={(e) => {
              if (zoom > minZoom) {
                // Enable panning when zoomed
                const startX = e.clientX - panX
                const startY = e.clientY - panY
                const handleMouseMove = (e: MouseEvent) => {
                  setPanX(e.clientX - startX)
                  setPanY(e.clientY - startY)
                }
                const handleMouseUp = () => {
                  document.removeEventListener('mousemove', handleMouseMove)
                  document.removeEventListener('mouseup', handleMouseUp)
                }
                document.addEventListener('mousemove', handleMouseMove)
                document.addEventListener('mouseup', handleMouseUp)
              }
            }}
          />
        </div>
      </div>

      {/* Resize handles */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Corner handles */}
        <div
          className="absolute top-0 left-0 w-4 h-4 cursor-nwse-resize pointer-events-auto bg-gray-400 opacity-0 hover:opacity-100 transition-opacity"
          style={{ borderTopLeftRadius: '6px' }}
          onMouseDown={(e) => handleResizeStart(e, 'top-left')}
        />
        <div
          className="absolute top-0 right-0 w-4 h-4 cursor-nesw-resize pointer-events-auto bg-gray-400 opacity-0 hover:opacity-100 transition-opacity"
          style={{ borderTopRightRadius: '6px' }}
          onMouseDown={(e) => handleResizeStart(e, 'top-right')}
        />
        <div
          className="absolute bottom-0 left-0 w-4 h-4 cursor-nesw-resize pointer-events-auto bg-gray-400 opacity-0 hover:opacity-100 transition-opacity"
          style={{ borderBottomLeftRadius: '6px' }}
          onMouseDown={(e) => handleResizeStart(e, 'bottom-left')}
        />
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize pointer-events-auto bg-gray-400 opacity-0 hover:opacity-100 transition-opacity"
          style={{ borderBottomRightRadius: '6px' }}
          onMouseDown={(e) => handleResizeStart(e, 'bottom-right')}
        />
        {/* Edge handles */}
        <div
          className="absolute top-0 left-4 right-4 h-2 cursor-ns-resize pointer-events-auto"
          onMouseDown={(e) => handleResizeStart(e, 'top')}
        />
        <div
          className="absolute bottom-0 left-4 right-4 h-2 cursor-ns-resize pointer-events-auto"
          onMouseDown={(e) => handleResizeStart(e, 'bottom')}
        />
        <div
          className="absolute left-0 top-4 bottom-4 w-2 cursor-ew-resize pointer-events-auto"
          onMouseDown={(e) => handleResizeStart(e, 'left')}
        />
        <div
          className="absolute right-0 top-4 bottom-4 w-2 cursor-ew-resize pointer-events-auto"
          onMouseDown={(e) => handleResizeStart(e, 'right')}
        />
      </div>
    </div>
  )
}