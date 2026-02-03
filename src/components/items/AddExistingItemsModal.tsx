import { ReactNode } from 'react'

type AddExistingItemsModalProps = {
  open: boolean
  title?: string
  onClose: () => void
  children: ReactNode
  contentId?: string
  modalPosition?: { top: number; left: number; width: number } | null
  isImagePinned?: boolean
  overlayClassName?: string
  wrapperClassName?: string
  modalClassName?: string
  contentClassName?: string
  overlayPointerEvents?: 'auto' | 'none'
}

export default function AddExistingItemsModal({
  open,
  title = 'Add Existing Items',
  onClose,
  children,
  contentId,
  modalPosition,
  isImagePinned,
  overlayClassName = '',
  wrapperClassName = '',
  modalClassName = '',
  contentClassName = '',
  overlayPointerEvents = 'auto'
}: AddExistingItemsModalProps) {
  if (!open) return null

  const baseWrapperClass = modalPosition
    ? 'fixed z-50'
    : isImagePinned
      ? 'fixed inset-x-0 bottom-0 z-50 h-[62vh] flex items-end justify-center'
      : 'fixed inset-0 z-50 flex items-end justify-center'

  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-black bg-opacity-50 ${overlayPointerEvents === 'none' ? 'pointer-events-none' : ''} ${overlayClassName}`}
      />
      <div
        className={`${baseWrapperClass} ${wrapperClassName}`}
        style={modalPosition ? {
          top: `${modalPosition.top}px`,
          left: `${modalPosition.left}px`,
          width: `${modalPosition.width}px`,
          maxWidth: 'calc(100% - 32px)',
          height: 'calc(100vh - 16px)'
        } : undefined}
        role="dialog"
        aria-modal="true"
      >
        <div
          className={`bg-white rounded-lg shadow-xl overflow-hidden ${
            modalPosition
              ? 'w-full h-[calc(100vh-16px)] max-h-none flex flex-col'
              : 'w-full max-w-5xl mx-4 h-[66vh] max-h-[66vh] flex flex-col'
          } ${modalClassName}`}
        >
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-lg font-medium text-gray-900">{title}</h3>
            <button
              type="button"
              onClick={onClose}
              className="text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              Close
            </button>
          </div>
          <div
            id={contentId}
            className={`overflow-y-auto flex-1 flex flex-col ${contentClassName}`}
          >
            {children}
          </div>
        </div>
      </div>
    </>
  )
}
