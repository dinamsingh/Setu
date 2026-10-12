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

export function VoiceInputControl({
  disabled = false,
  onFinalTranscript,
  onInterimTranscript,
  onStatusChange,
}: VoiceInputControlProps) {
  const [isListening, setIsListening] = useState(false);
  const [language, setLanguage] = useState<SpeechLanguage>('en-IN');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const lastProcessedFinalIndexRef = useRef<number>(-1);

  // Stop & cleanup recognition on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  // When disabled (e.g., during report submission), stop listening
  useEffect(() => {
    if (disabled && isListening) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
    }
  }, [disabled, isListening]);

  const toggleListening = () => {
    if (disabled) return;

    // Check browser support
    const SpeechRecognitionAPI = (window as unknown as {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    }).SpeechRecognition || (window as unknown as {
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    }).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      onStatusChange?.('Voice input is not supported in this browser. You can continue typing manually.');
      return;
    }

    if (isListening) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
      setIsListening(false);
      onInterimTranscript?.('');
      return;
    }

    // Start recognition session on explicit user click
    onStatusChange?.(null);
    onInterimTranscript?.('');
    lastProcessedFinalIndexRef.current = -1;

    try {
      const recognition = new SpeechRecognitionAPI();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = language;

      recognition.onstart = () => {
        setIsListening(true);
        lastProcessedFinalIndexRef.current = -1;
      };

      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        let interim = '';
        const startIndex = typeof event.resultIndex === 'number' ? event.resultIndex : 0;
        for (let i = startIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            // Deduplicate: only append if this index has not been finalized yet
            if (i > lastProcessedFinalIndexRef.current) {
              lastProcessedFinalIndexRef.current = i;
              const finalChunk = result[0]?.transcript?.trim();
              if (finalChunk) {
                onFinalTranscript(finalChunk);
              }
            }
          } else {
            interim += (result[0]?.transcript || '');
          }
        }
        onInterimTranscript?.(interim.trim());
      };

      recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
        setIsListening(false);
        onInterimTranscript?.('');
        lastProcessedFinalIndexRef.current = -1;

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
        onStatusChange?.(errorMsg);
      };

      recognition.onend = () => {
        setIsListening(false);
        onInterimTranscript?.('');
        lastProcessedFinalIndexRef.current = -1;
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: unknown) {
      setIsListening(false);
      onInterimTranscript?.('');
      const message = err instanceof Error ? err.message : 'Failed to start speech recognition.';
      onStatusChange?.(message);
    }
  };

  return (
    <div className="absolute bottom-3 right-3 flex items-center gap-2">
      <select
        aria-label="Voice input language"
        value={language}
        onChange={e => setLanguage(e.target.value as SpeechLanguage)}
        disabled={isListening || disabled}
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
