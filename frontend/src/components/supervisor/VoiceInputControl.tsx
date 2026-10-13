import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';

export type SpeechLanguage = 'en-IN' | 'hi-IN';

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      length: number;
      [index: number]: {
        transcript: string;
      };
    };
  };
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export interface VoiceInputControlProps {
  disabled?: boolean;
  onFinalTranscript: (chunk: string) => void;
  onInterimTranscript?: (interim: string) => void;
  onStatusChange?: (status: string | null) => void;
}

interface ActiveSession {
  id: number;
  recognition: SpeechRecognitionLike;
  status: 'starting' | 'listening' | 'stopping' | 'closed';
  lastProcessedFinalIndex: number;
}

export function VoiceInputControl({
  disabled = false,
  onFinalTranscript,
  onInterimTranscript,
  onStatusChange,
}: VoiceInputControlProps) {
  const [isListening, setIsListening] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [language, setLanguage] = useState<SpeechLanguage>('en-IN');

  const activeSessionRef = useRef<ActiveSession | null>(null);
  const sessionIdCounterRef = useRef<number>(0);
  const disabledRef = useRef<boolean>(disabled);

  const onFinalTranscriptRef = useRef(onFinalTranscript);
  const onInterimTranscriptRef = useRef(onInterimTranscript);
  const onStatusChangeRef = useRef(onStatusChange);

  useEffect(() => {
    disabledRef.current = disabled;
    onFinalTranscriptRef.current = onFinalTranscript;
    onInterimTranscriptRef.current = onInterimTranscript;
    onStatusChangeRef.current = onStatusChange;
  }, [disabled, onFinalTranscript, onInterimTranscript, onStatusChange]);

  // Cleanup & abort recognition on unmount
  useEffect(() => {
    return () => {
      if (activeSessionRef.current) {
        const session = activeSessionRef.current;
        session.status = 'closed';
        activeSessionRef.current = null;
        try {
          session.recognition.abort();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  // When disabled becomes true (e.g., during report submission), immediately stop active session
  // and discard any pending transcription so reports cannot be mutated after submission starts
  useEffect(() => {
    if (disabled && activeSessionRef.current) {
      const session = activeSessionRef.current;
      session.status = 'closed';
      activeSessionRef.current = null;
      try {
        session.recognition.stop();
      } catch {
        // ignore
      }
      setIsStarting(false);
      setIsListening(false);
      onInterimTranscriptRef.current?.('');
    }
  }, [disabled]);

  const toggleListening = () => {
    if (disabledRef.current) return;

    // Check browser support
    const SpeechRecognitionAPI = (window as unknown as {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    }).SpeechRecognition || (window as unknown as {
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    }).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      onStatusChangeRef.current?.('Voice input is not supported in this browser. You can continue typing manually.');
      return;
    }

    const currentSession = activeSessionRef.current;
    if (currentSession) {
      // 1. If a session is currently starting asynchronously, ignore rapid repeated clicks to prevent overlapping sessions
      if (currentSession.status === 'starting') {
        return;
      }

      // 2. If actively listening, transition to 'stopping' to allow legitimate final speech results while disallowing new audio
      if (currentSession.status === 'listening') {
        currentSession.status = 'stopping';
        setIsStarting(false);
        setIsListening(false);
        onInterimTranscriptRef.current?.('');
        try {
          currentSession.recognition.stop();
        } catch {
          // ignore
        }
        return;
      }

      // 3. If currently stopping and user clicks to start again, close and abort the stopping session before starting a fresh one
      if (currentSession.status === 'stopping') {
        currentSession.status = 'closed';
        try {
          currentSession.recognition.abort();
        } catch {
          // ignore
        }
        activeSessionRef.current = null;
      }
    }

    // Start a new recognition session with an incremented unique session ID
    onStatusChangeRef.current?.(null);
    onInterimTranscriptRef.current?.('');

    const sessionId = ++sessionIdCounterRef.current;
    try {
      const recognition = new SpeechRecognitionAPI();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = language;

      const session: ActiveSession = {
        id: sessionId,
        recognition,
        status: 'starting',
        lastProcessedFinalIndex: -1,
      };
      activeSessionRef.current = session;
      setIsStarting(true);

      recognition.onstart = () => {
        // Ignore if this session was cancelled, closed, or superseded before onstart arrived
        if (activeSessionRef.current?.id !== session.id || session.status === 'closed') {
          try {
            recognition.abort();
          } catch {
            // ignore
          }
          return;
        }
        session.status = 'listening';
        setIsStarting(false);
        setIsListening(true);
        session.lastProcessedFinalIndex = -1;
      };

      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        // Discard any callbacks from obsolete, cancelled, or closed sessions, or during submission
        if (activeSessionRef.current?.id !== session.id || session.status === 'closed' || disabledRef.current) {
          return;
        }

        let interim = '';
        const startIndex = typeof event.resultIndex === 'number' ? event.resultIndex : 0;
        for (let i = startIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            // Deduplicate: only append if this index has not been finalized yet for this session
            if (i > session.lastProcessedFinalIndex) {
              session.lastProcessedFinalIndex = i;
              const finalChunk = result[0]?.transcript?.trim();
              if (finalChunk && !disabledRef.current) {
                onFinalTranscriptRef.current(finalChunk);
              }
            }
          } else if (session.status === 'listening') {
            interim += (result[0]?.transcript || '');
          }
        }

        // Only emit interim updates when actively listening (not during stopping or disabled)
        if (session.status === 'listening' && !disabledRef.current) {
          onInterimTranscriptRef.current?.(interim.trim());
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
        // Discard errors from obsolete sessions
        if (activeSessionRef.current?.id !== session.id || session.status === 'closed') {
          return;
        }
        session.status = 'closed';
        activeSessionRef.current = null;
        setIsStarting(false);
        setIsListening(false);
        onInterimTranscriptRef.current?.('');
        session.lastProcessedFinalIndex = -1;

        let errorMsg = 'Speech recognition error occurred.';
        if (event.error === 'not-allowed') {
          errorMsg = 'Microphone access was denied. Please allow microphone permissions in your browser.';
        } else if (event.error === 'no-speech') {
          errorMsg = 'No speech detected. Please speak into your microphone and try again.';
        } else if (event.error === 'network') {
          errorMsg = 'Network error occurred during speech recognition. Please check your connection.';
        } else if (event.error === 'audio-capture') {
          errorMsg = 'No microphone was found on this device.';
        } else if (event.message) {
          errorMsg = event.message;
        }
        onStatusChangeRef.current?.(errorMsg);
      };

      recognition.onend = () => {
        // Discard delayed onend events from obsolete or previous sessions
        if (activeSessionRef.current?.id !== session.id) {
          return;
        }
        session.status = 'closed';
        activeSessionRef.current = null;
        setIsStarting(false);
        setIsListening(false);
        onInterimTranscriptRef.current?.('');
        session.lastProcessedFinalIndex = -1;
      };

      recognition.start();
    } catch (err: unknown) {
      if (activeSessionRef.current?.id === sessionId) {
        activeSessionRef.current.status = 'closed';
        activeSessionRef.current = null;
      }
      setIsStarting(false);
      setIsListening(false);
      onInterimTranscriptRef.current?.('');
      const message = err instanceof Error ? err.message : 'Failed to start speech recognition.';
      onStatusChangeRef.current?.(message);
    }
  };

  return (
    <div className="absolute bottom-3 right-3 flex items-center gap-2">
      <select
        aria-label="Voice input language"
        value={language}
        onChange={e => setLanguage(e.target.value as SpeechLanguage)}
        disabled={isListening || isStarting || disabled}
        title="Select voice input language (Mixed-language Hinglish accuracy is best-effort)"
        className="h-9 rounded-xl border border-slate-200 bg-white/95 px-2 text-xs font-semibold text-[#123F77] shadow-xs outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="en-IN">EN (IN)</option>
        <option value="hi-IN">HI (हिन्दी)</option>
      </select>

      <button
        type="button"
        disabled={disabled}
        aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
        aria-pressed={isListening}
        title={isListening ? 'Stop voice input' : 'Start voice input'}
        onClick={toggleListening}
        className={`flex h-11 w-11 items-center justify-center rounded-full border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 ${
          isListening
            ? 'border-rose-300 bg-rose-50 text-rose-600 ring-2 ring-rose-400 ring-offset-1 animate-pulse focus-visible:ring-rose-500'
            : 'border-slate-200 bg-slate-50 text-[#123F77] hover:bg-blue-50 focus-visible:ring-blue-500'
        }`}
      >
        {isListening ? (
          <MicOff size={21} aria-hidden="true" />
        ) : (
          <Mic size={21} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
