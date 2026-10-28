export type PropertyModalContext = 'search' | 'in-work' | 'proposal' | 'approval'

interface PropertyModalState {
  open: boolean
  projectId: string
  context: PropertyModalContext
  initialTab: 'object' | 'workflow' | 'proposal' | 'approval'
  draft?: any
}

export function usePropertyModal() {
  const state = useState<PropertyModalState>('property-modal', () => ({
    open: false,
    projectId: '',
    context: 'search',
    initialTab: 'object'
  }))

  function openProject(projectId: string, context: PropertyModalContext, initialTab?: PropertyModalState['initialTab']) {
    state.value = {
      open: true,
      projectId,
      context,
      initialTab: initialTab || (context === 'approval' ? 'approval' : context === 'proposal' ? 'proposal' : 'object')
    }
  }

  function createProject(context: PropertyModalContext = 'search') {
    state.value = { open: true, projectId: '', context, initialTab: 'object', draft: {} }
  }

  function openDraft(draft: any, context: PropertyModalContext = 'search') {
    state.value = { open: true, projectId: '', context, initialTab: 'object', draft }
  }

  function close() {
    state.value = { ...state.value, open: false, draft: undefined }
  }

  return { state, openProject, createProject, openDraft, close }
}
