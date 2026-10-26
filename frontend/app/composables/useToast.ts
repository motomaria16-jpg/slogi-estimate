export function useToast() {
  const toast = useState('app-toast', () => ({ message: '', tone: 'success' as 'success' | 'error', visible: false }))
  let timer: ReturnType<typeof setTimeout> | undefined
  function show(message: string, tone: 'success' | 'error' = 'success') {
    toast.value = { message, tone, visible: true }
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { toast.value.visible = false }, 3600)
  }
  return { toast, show }
}
