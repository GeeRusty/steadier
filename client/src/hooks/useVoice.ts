import { useCallback, useEffect, useRef, useState } from 'react';

interface RecognitionAlternative {
  transcript: string;
}

interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: RecognitionAlternative;
}

interface RecognitionResults {
  readonly length: number;
  [index: number]: RecognitionResult;
}

interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: RecognitionResults;
}

interface RecognitionErrorEvent {
  readonly error: string;
  readonly message?: string;
}

interface RecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type RecognitionConstructor = new () => RecognitionInstance;

interface SpeechVoice {
  readonly lang: string;
}

interface Utterance {
  lang: string;
  voice: SpeechVoice | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

type UtteranceConstructor = new (text: string) => Utterance;

interface SpeechSynthesisApi {
  getVoices: () => SpeechVoice[];
  speak: (utterance: Utterance) => void;
  cancel: () => void;
}

interface BrowserVoiceApis {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
  SpeechSynthesisUtterance?: UtteranceConstructor;
  speechSynthesis?: SpeechSynthesisApi;
}

export interface VoiceControls {
  supported: boolean;
  speechSupported: boolean;
  listening: boolean;
  speaking: boolean;
  transcript: string;
  finalTranscript: string;
  interimTranscript: string;
  error: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  clear: () => void;
  read: (text: string) => void;
  stopSpeaking: () => void;
}

function browserApis(): BrowserVoiceApis | null {
  if (typeof window === 'undefined') return null;
  return window as unknown as BrowserVoiceApis;
}

function getRecognitionConstructor(): RecognitionConstructor | null {
  const apis = browserApis();
  return apis?.SpeechRecognition ?? apis?.webkitSpeechRecognition ?? null;
}

function canSpeak(): boolean {
  const apis = browserApis();
  return Boolean(apis?.speechSynthesis && apis.SpeechSynthesisUtterance);
}

function safely(action: () => void) {
  try {
    action();
  } catch {
    // Browser speech APIs can throw while they are changing state.
  }
}

function recognitionError(error: string, message?: string): string {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone permission was denied. Allow microphone access in your browser settings and try again.';
    case 'network':
      return 'Speech recognition needs a network connection in this browser. Check your connection and try again.';
    case 'no-speech':
      return 'No speech was detected. Try again when you are ready to dictate.';
    case 'audio-capture':
      return 'No microphone was found or it is unavailable to this browser.';
    case 'language-not-supported':
      return 'Australian English speech recognition is not available in this browser.';
    default:
      return message
        ? `Speech recognition failed: ${message}`
        : 'Speech recognition could not start. Try the full version of Chrome with an internet connection.';
  }
}

function joinTranscript(parts: Map<number, string>): string {
  return Array.from(parts.entries())
    .sort(([left], [right]) => left - right)
    .map(([, part]) => part.trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * Explicit browser dictation and read-aloud controls. This hook never starts
 * recording, sends commands, or begins speech synthesis without a user action.
 */
export function useVoice(): VoiceControls {
  const [supported] = useState(() => Boolean(getRecognitionConstructor()));
  const [speechSupported] = useState(canSpeak);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState('');

  const recognitionRef = useRef<RecognitionInstance | null>(null);
  const discardRecognitionRef = useRef(false);
  const utteranceRef = useRef<Utterance | null>(null);

  const clear = useCallback(() => {
    setTranscript('');
    setFinalTranscript('');
    setInterimTranscript('');
    setError('');
  }, []);

  const start = useCallback(() => {
    const Recognition = getRecognitionConstructor();
    if (!Recognition) {
      setListening(false);
      setError('Speech recognition is not available in this browser. Try the full version of Chrome; browser speech recognition may also need a connection.');
      return;
    }

    // A second click must not leave a previous browser capture running.
    if (recognitionRef.current) return;

    setTranscript('');
    setFinalTranscript('');
    setInterimTranscript('');
    setError('');
    discardRecognitionRef.current = false;

    const recognition = new Recognition();
    const finalParts = new Map<number, string>();
    const interimParts = new Map<number, string>();

    recognition.lang = 'en-AU';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = event => {
      if (discardRecognitionRef.current) return;

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result?.[0]?.transcript?.trim() ?? '';
        if (result?.isFinal) {
          finalParts.set(index, text);
          interimParts.delete(index);
        } else {
          interimParts.set(index, text);
        }
      }

      const finalText = joinTranscript(finalParts);
      const interimText = joinTranscript(interimParts);
      setFinalTranscript(finalText);
      setInterimTranscript(interimText);
      setTranscript([finalText, interimText].filter(Boolean).join(' '));
    };

    recognition.onerror = event => {
      if (discardRecognitionRef.current && event.error === 'aborted') return;
      setError(recognitionError(event.error, event.message));
    };

    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      setListening(false);
      discardRecognitionRef.current = false;
    };

    recognitionRef.current = recognition;
    setListening(true);
    try {
      recognition.start();
    } catch {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      setListening(false);
      setError('Speech recognition could not start. Check microphone permission and try again.');
    }
  }, []);

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    // stop() lets the browser deliver a final result before it ends.
    discardRecognitionRef.current = false;
    safely(() => recognition.stop());
  }, []);

  const abort = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    // Ignore any late interim/final events from this explicitly discarded capture.
    discardRecognitionRef.current = true;
    setTranscript('');
    setFinalTranscript('');
    setInterimTranscript('');
    setListening(false);
    safely(() => recognition.abort());
  }, []);

  const stopSpeaking = useCallback(() => {
    const apis = browserApis();
    utteranceRef.current = null;
    setSpeaking(false);
    if (apis?.speechSynthesis) safely(() => apis.speechSynthesis!.cancel());
  }, []);

  const read = useCallback((text: string) => {
    const apis = browserApis();
    const content = text.trim();
    if (!apis?.speechSynthesis || !apis.SpeechSynthesisUtterance) {
      setSpeaking(false);
      setError('Read-aloud is not available in this browser.');
      return;
    }
    if (!content) {
      setError('There is nothing to read aloud.');
      return;
    }

    // Cancel first so callbacks from an older utterance can no longer change state.
    utteranceRef.current = null;
    safely(() => apis.speechSynthesis!.cancel());

    const utterance = new apis.SpeechSynthesisUtterance(content);
    utterance.lang = 'en-AU';
    const voices = apis.speechSynthesis.getVoices();
    utterance.voice = voices.find(voice => voice.lang.toLowerCase().startsWith('en-au'))
      ?? voices.find(voice => voice.lang.toLowerCase().startsWith('en'))
      ?? null;

    utterance.onstart = () => {
      if (utteranceRef.current === utterance) setSpeaking(true);
    };
    utterance.onend = () => {
      if (utteranceRef.current !== utterance) return;
      utteranceRef.current = null;
      setSpeaking(false);
    };
    utterance.onerror = () => {
      if (utteranceRef.current !== utterance) return;
      utteranceRef.current = null;
      setSpeaking(false);
      setError('Read-aloud stopped before it could finish.');
    };

    utteranceRef.current = utterance;
    setError('');
    setSpeaking(true);
    try {
      apis.speechSynthesis.speak(utterance);
    } catch {
      if (utteranceRef.current === utterance) utteranceRef.current = null;
      setSpeaking(false);
      setError('Read-aloud could not start in this browser.');
    }
  }, []);

  useEffect(() => () => {
    const recognition = recognitionRef.current;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      safely(() => recognition.abort());
      recognitionRef.current = null;
    }

    utteranceRef.current = null;
    const apis = browserApis();
    if (apis?.speechSynthesis) safely(() => apis.speechSynthesis!.cancel());
  }, []);

  return {
    supported,
    speechSupported,
    listening,
    speaking,
    transcript,
    finalTranscript,
    interimTranscript,
    error,
    start,
    stop,
    abort,
    clear,
    read,
    stopSpeaking,
  };
}
