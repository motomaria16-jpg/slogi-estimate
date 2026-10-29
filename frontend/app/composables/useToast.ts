export function useToast() {
  const toast = useState('app-toast', () => ({ message: '', tone: 'success' as 'success' | 'error', visible: false }))
  const timer = useState<number | null>('app-toast-timer', () => null)

  function clearTimer() {
    if (!import.meta.client || timer.value == null) return
    window.clearTimeout(timer.value)
    timer.value = null
  }

  function hide() {
    clearTimer()
    toast.value = { ...toast.value, visible: false }
  }

  function show(message: string, tone: 'success' | 'error' = 'success') {
    clearTimer()
    toast.value = { message, tone, visible: true }
    if (import.meta.client && tone === 'success') timer.value = window.setTimeout(hide, 3600)
  }
  return { toast, show, hide }
}
