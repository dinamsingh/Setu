// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceInputControl } from './VoiceInputControl';

// Mock MockSpeechRecognition
class MockSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = 'en-IN';
  onstart: (() => void) | null = null;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;

  start = vi.fn(() => {
    if (this.onstart) this.onstart();
  });
  stop = vi.fn(() => {
    if (this.onend) this.onend();
  });
  abort = vi.fn(() => {
    if (this.onend) this.onend();
  });

  static instances: MockSpeechRecognition[] = [];
  constructor() {
    MockSpeechRecognition.instances.push(this);
  }
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  MockSpeechRecognition.instances = [];
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = MockSpeechRecognition;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
});

describe('VoiceInputControl', () => {
  it('starts and stops voice recognition on button click', async () => {
    const onFinal = vi.fn();
    const onInterim = vi.fn();
    const onStatus = vi.fn();

    await act(async () => {
      root.render(
        <VoiceInputControl
          onFinalTranscript={onFinal}
          onInterimTranscript={onInterim}
          onStatusChange={onStatus}
        />
      );
    });

    const button = container.querySelector('button[aria-label="Start voice input"]') as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button.getAttribute('aria-pressed')).toBe('false');

    // Click to start
    await act(async () => {
      button.click();
    });

    expect(MockSpeechRecognition.instances.length).toBe(1);
    const recognition = MockSpeechRecognition.instances[0];
    expect(recognition.start).toHaveBeenCalled();
    expect(recognition.lang).toBe('en-IN');
    expect(recognition.continuous).toBe(true);
    expect(recognition.interimResults).toBe(true);

    expect(button.getAttribute('aria-label')).toBe('Stop voice input');
    expect(button.getAttribute('aria-pressed')).toBe('true');

    // Click to stop
    await act(async () => {
      button.click();
    });

    expect(recognition.stop).toHaveBeenCalled();
    expect(button.getAttribute('aria-label')).toBe('Start voice input');
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('allows language selection between English and Hindi', async () => {
    await act(async () => {
      root.render(
        <VoiceInputControl
          onFinalTranscript={vi.fn()}
        />
      );
    });

    const select = container.querySelector('select[aria-label="Voice input language"]') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe('en-IN');

    // Change to Hindi
    await act(async () => {
      select.value = 'hi-IN';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(select.value).toBe('hi-IN');

    // Start recognition and verify language passed
    const button = container.querySelector('button') as HTMLButtonElement;
    await act(async () => {
      button.click();
    });

    const recognition = MockSpeechRecognition.instances[0];
    expect(recognition.lang).toBe('hi-IN');
    // Language dropdown should be disabled while listening
    expect(select.disabled).toBe(true);
  });

  it('handles interim and final transcripts with deduplication', async () => {
    const onFinal = vi.fn();
    const onInterim = vi.fn();

    await act(async () => {
      root.render(
        <VoiceInputControl
          onFinalTranscript={onFinal}
          onInterimTranscript={onInterim}
        />
      );
    });

    const button = container.querySelector('button') as HTMLButtonElement;
    await act(async () => {
      button.click();
    });

    const recognition = MockSpeechRecognition.instances[0];

    // Emit interim result
    await act(async () => {
      recognition.onresult?.({
        resultIndex: 0,
        results: [
          {
            isFinal: false,
            0: { transcript: 'piping spool' },
          },
        ],
      });
    });

    expect(onInterim).toHaveBeenCalledWith('piping spool');
    expect(onFinal).not.toHaveBeenCalled();

    // Emit final result at index 0
    await act(async () => {
      recognition.onresult?.({
        resultIndex: 0,
        results: [
          {
            isFinal: true,
            0: { transcript: 'piping spool completed' },
          },
        ],
      });
    });

    expect(onFinal).toHaveBeenCalledTimes(1);
    expect(onFinal).toHaveBeenCalledWith('piping spool completed');

    // Emit the exact same final result again (e.g. repeated browser event)
    await act(async () => {
      recognition.onresult?.({
        resultIndex: 0,
        results: [
          {
            isFinal: true,
            0: { transcript: 'piping spool completed' },
          },
        ],
      });
    });

    // Should NOT duplicate the final chunk
    expect(onFinal).toHaveBeenCalledTimes(1);

    // Emit a second final chunk at index 1
    await act(async () => {
      recognition.onresult?.({
        resultIndex: 1,
        results: [
          {
            isFinal: true,
            0: { transcript: 'piping spool completed' },
          },
          {
            isFinal: true,
            0: { transcript: 'at manifold A' },
          },
        ],
      });
    });

    expect(onFinal).toHaveBeenCalledTimes(2);
    expect(onFinal).toHaveBeenLastCalledWith('at manifold A');
  });

  it('reports unsupported error when browser does not support SpeechRecognition', async () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;

    const onStatus = vi.fn();
    await act(async () => {
      root.render(
        <VoiceInputControl
          onFinalTranscript={vi.fn()}
          onStatusChange={onStatus}
        />
      );
    });

    const button = container.querySelector('button') as HTMLButtonElement;
    await act(async () => {
      button.click();
    });

    expect(onStatus).toHaveBeenCalledWith(
      'Voice input is not supported in this browser. You can continue typing manually.'
    );
  });

  it('handles permission denied (not-allowed) error gracefully', async () => {
    const onStatus = vi.fn();
    await act(async () => {
      root.render(
        <VoiceInputControl
          onFinalTranscript={vi.fn()}
          onStatusChange={onStatus}
        />
      );
    });

    const button = container.querySelector('button') as HTMLButtonElement;
    await act(async () => {
      button.click();
    });

    const recognition = MockSpeechRecognition.instances[0];

    await act(async () => {
      recognition.onerror?.({ error: 'not-allowed' });
    });

    expect(onStatus).toHaveBeenCalledWith(
      'Microphone access was denied. Please allow microphone permissions in your browser.'
    );
    expect(button.getAttribute('aria-label')).toBe('Start voice input');
  });

  it('cleans up and aborts recognition on unmount', async () => {
    await act(async () => {
      root.render(
        <VoiceInputControl
          onFinalTranscript={vi.fn()}
        />
      );
    });

    const button = container.querySelector('button') as HTMLButtonElement;
    await act(async () => {
      button.click();
    });

    const recognition = MockSpeechRecognition.instances[0];

    await act(async () => {
      root.unmount();
    });

    expect(recognition.abort).toHaveBeenCalled();
  });

  it('stops listening when disabled becomes true', async () => {
    const onInterim = vi.fn();
    await act(async () => {
      root.render(
        <VoiceInputControl
          disabled={false}
          onFinalTranscript={vi.fn()}
          onInterimTranscript={onInterim}
        />
      );
    });

    const button = container.querySelector('button') as HTMLButtonElement;
    await act(async () => {
      button.click();
    });

    const recognition = MockSpeechRecognition.instances[0];

    // Re-render with disabled=true (e.g. submitting report)
    await act(async () => {
      root.render(
        <VoiceInputControl
          disabled={true}
          onFinalTranscript={vi.fn()}
          onInterimTranscript={onInterim}
        />
      );
    });

    expect(recognition.stop).toHaveBeenCalled();
    expect(onInterim).toHaveBeenCalledWith('');
  });
});
