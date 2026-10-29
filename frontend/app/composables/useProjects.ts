export function useProjects() {
  const { ready, api } = useSlogiRuntime()
  const projects = useState<any[]>('slogi-projects', () => [])

  function refresh() {
    const runtime = api()
    projects.value = runtime?.phase0?.projectRepository?.listAll?.() || []
  }

  const searchProjects = computed(() => projects.value.filter((project) => {
    const lifecycle = api()?.phase0?.spaceLifecycle
    return lifecycle?.isSearchCandidateProject ? lifecycle.isSearchCandidateProject(project) : false
  }))
  const inWorkProjects = computed(() => projects.value.filter((project) => {
    const lifecycle = api()?.phase0?.spaceLifecycle
    return lifecycle?.isActiveWorkProject ? lifecycle.isActiveWorkProject(project) : false
  }))
  const proposalProjects = computed(() => projects.value.filter(project => api()?.proposal?.isProposalProject?.(project)))
  const approvalProjects = computed(() => projects.value.filter(project => api()?.approval?.isApprovalProject?.(project)))
  const repairProjects = computed(() => projects.value.filter(project => api()?.repair?.isRepairProject?.(project)))

  if (import.meta.client) {
    const events = ['slogi:runtime-ready', 'slogi:locations-updated', 'slogi:workspace-updated', 'slogi:shared-workspace-ready']
    watch(ready, value => { if (value) refresh() }, { immediate: true })
    onMounted(() => {
      events.forEach(name => window.addEventListener(name, refresh))
      refresh()
    })
    onBeforeUnmount(() => events.forEach(name => window.removeEventListener(name, refresh)))
  }

  return { projects: readonly(projects), searchProjects, inWorkProjects, proposalProjects, approvalProjects, repairProjects, refresh }
}
