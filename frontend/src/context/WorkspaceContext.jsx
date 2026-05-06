import { createContext, useContext, useMemo, useState } from 'react'

const WorkspaceContext = createContext(null)

const INITIAL_COUNT_SESSION = {
  step: 0,
  backendMode: 'motion',
  trialMode: 'motion',
  videoFile: null,
  downloadName: 'bee_count_result',
  frame: null,
  frameW: 960,
  frameH: 540,
  suggestedSetup: null,
  tunedSetup: null,
  useRoi: true,
  roi: null,
  draftRoi: null,
  lineStart: null,
  lineEnd: null,
  lineDraftEnd: null,
  hivePoint: null,
  result: null,
  error: '',
  dragging: false,
  uploading: false,
  progressLabel: '',
  progressPercent: 0,
  progressMode: 'determinate',
  processingFactIndex: 0
}

const INITIAL_AI_MESSAGES = [
  {
    role: 'assistant',
    text: 'I can help interpret live hive traffic, saved reports, and next field checks from the project data.'
  }
]

export function WorkspaceProvider({ children }) {
  const [countSession, setCountSession] = useState(INITIAL_COUNT_SESSION)
  const [assistantMessages, setAssistantMessages] = useState(INITIAL_AI_MESSAGES)
  const [assistantInput, setAssistantInput] = useState('')
  const [assistantLoading, setAssistantLoading] = useState(false)

  function setCountField(key, value) {
    setCountSession(current => ({
      ...current,
      [key]: typeof value === 'function' ? value(current[key]) : value
    }))
  }

  function resetCountSession() {
    setCountSession(INITIAL_COUNT_SESSION)
  }

  function resetAssistantSession() {
    setAssistantMessages(INITIAL_AI_MESSAGES)
    setAssistantInput('')
    setAssistantLoading(false)
  }

  const countSetters = useMemo(() => ({
    setStep: value => setCountField('step', value),
    setBackendMode: value => setCountField('backendMode', value),
    setTrialMode: value => setCountField('trialMode', value),
    setVideoFile: value => setCountField('videoFile', value),
    setDownloadName: value => setCountField('downloadName', value),
    setFrame: value => setCountField('frame', value),
    setFrameW: value => setCountField('frameW', value),
    setFrameH: value => setCountField('frameH', value),
    setSuggestedSetup: value => setCountField('suggestedSetup', value),
    setTunedSetup: value => setCountField('tunedSetup', value),
    setUseRoi: value => setCountField('useRoi', value),
    setRoi: value => setCountField('roi', value),
    setDraftRoi: value => setCountField('draftRoi', value),
    setLineStart: value => setCountField('lineStart', value),
    setLineEnd: value => setCountField('lineEnd', value),
    setLineDraftEnd: value => setCountField('lineDraftEnd', value),
    setHivePoint: value => setCountField('hivePoint', value),
    setResult: value => setCountField('result', value),
    setError: value => setCountField('error', value),
    setDragging: value => setCountField('dragging', value),
    setUploading: value => setCountField('uploading', value),
    setProgressLabel: value => setCountField('progressLabel', value),
    setProgressPercent: value => setCountField('progressPercent', value),
    setProgressMode: value => setCountField('progressMode', value),
    setProcessingFactIndex: value => setCountField('processingFactIndex', value),
    resetCountSession
  }), [])

  const value = useMemo(() => ({
    countSession,
    countSetters,
    assistant: {
      messages: assistantMessages,
      setMessages: setAssistantMessages,
      input: assistantInput,
      setInput: setAssistantInput,
      loading: assistantLoading,
      setLoading: setAssistantLoading,
      resetAssistantSession
    }
  }), [assistantInput, assistantLoading, assistantMessages, countSession, countSetters])

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext)
  if (!context) {
    throw new Error('useWorkspace must be used within WorkspaceProvider')
  }
  return context
}
