export function useSlogiRuntime() {
  const ready = useState<boolean>('slogi-runtime-ready', () => false)
  const error = useState<string>('slogi-runtime-error', () => '')

  function api() {
    if (!import.meta.client || !ready.value) return null
    return {
      phase0: window.SlogiPhase0,
      workflow: window.SlogiWorkflow,
      pro: window.SlogiPro,
      cloud: window.SlogiCloud,
      calendar: window.SlogiWorkCalendar,
      proposal: window.SlogiProposalStage,
      approval: window.SlogiApprovalStage,
      repair: window.SlogiRepairStage,
      repairEstimate: window.SlogiRepairEstimate,
      repairDocumentsXlsx: window.SlogiRepairDocumentsXlsx,
      proposalDocument: window.SlogiProposalDocument,
      feed: window.SlogiCianFeed,
      mapData: window.SlogiCianMapData
    }
  }

  return { ready: readonly(ready), error: readonly(error), api }
}
