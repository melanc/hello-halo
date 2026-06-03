import { create } from 'zustand'

export interface SessionReport {
  durationMs: number
  inputTokens: number
  outputTokens: number
  stage: number
}

interface SessionReportState {
  report: SessionReport | null
  setReport: (report: SessionReport | null) => void
}

export const useSessionReportStore = create<SessionReportState>((set) => ({
  report: null,
  setReport: (report) => set({ report }),
}))
