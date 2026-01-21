import { Mic, MicOff } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

type SpeechMicButtonProps = {
  value: string
  onChangeText: (next: string) => void
  label: string
  /**
   * If true, spoken text is appended to the existing value (captured at start).
   * If false, spoken text replaces the value.
   */
  append?: boolean
  /**
   * Optional normalization for the transcript before writing into the field.
   * - 'none': leave transcript as-is (trimmed)
   * - 'sku': remove all whitespace (so "1 2 3" -> "123")
   */
  normalize?: 'none' | 'sku'
  /**
   * Speech recognition language tag, e.g. "en-US"
   */
  lang?: string
  className?: string
  disabled?: boolean
}

export default function SpeechMicButton({
  value,
  onChangeText,
  label,
  append = false,
  normalize = 'none',
  lang = 'en-US',
  className = '',
  disabled = false
}: SpeechMicButtonProps) {
  const isSupported = useMemo(() => {
    if (typeof window === 'undefined') return false
    const w = window as any
    return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition)
  }, [])

  const recognitionRef = useRef<any>(null)
  const baseValueRef = useRef<string>('')
  const [isListening, setIsListening] = useState(false)

  const stop = () => {
    try {
      recognitionRef.current?.stop?.()
    } catch {
      // noop
    } finally {
      recognitionRef.current = null
      setIsListening(false)
    }
  }

  const start = () => {
    if (!isSupported || disabled) return

    // If already listening, treat click as "stop".
    if (isListening) {
      stop()
      return
    }

    const w = window as any
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition
    if (!Ctor) return

    baseValueRef.current = value

    const recognition = new Ctor()
    recognitionRef.current = recognition

    recognition.lang = lang
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onresult = (event: any) => {
      let transcript = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += String(event.results[i][0]?.transcript ?? '')
      }
      let cleaned = transcript.trim()
      if (!cleaned) return

      if (normalize === 'sku') {
        cleaned = cleaned.replace(/\s+/g, '')
      }

      const base = append ? baseValueRef.current.trim() : ''
      const next = append ? (base ? `${base} ${cleaned}` : cleaned) : cleaned
      onChangeText(next)
    }

    recognition.onerror = () => {
      stop()
    }

    recognition.onend = () => {
      stop()
    }

    try {
      recognition.start()
      setIsListening(true)
    } catch {
      stop()
    }
  }

  useEffect(() => stop, [])

  const title = !isSupported
    ? `${label}: speech input not supported on this browser`
    : isListening
      ? `${label}: stop listening`
      : `${label}: tap to speak`

  return (
    <button
      type="button"
      onClick={start}
      disabled={disabled || !isSupported}
      aria-label={title}
      title={title}
      className={[
        'absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-2 py-2 text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className
      ].join(' ')}
    >
      {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
    </button>
  )
}

