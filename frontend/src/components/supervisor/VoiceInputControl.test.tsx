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

  static autoStart = true;
  static autoEndOnStop = true;

  start = vi.fn(() => {
    if (MockSpeechRecognition.autoStart && this.onstart) this.onstart();
  });
  stop = vi.fn(() => {
    if (MockSpeechRecognition.autoEndOnStop && this.onend) this.onend();
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
  MockSpeechRecognition.autoStart = true;
  MockSpeechRecognition.autoEndOnStop = true;
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

  it('prevents overlapping recognition sessions on rapid repeated clicks before onstart', async () => {
    // Disable autoStart to simulate asynchronous browser recognition start
    MockSpeechRecognition.autoStart = false;

    const onFinal = vi.fn();
    await act(async () => {
      root.render(<VoiceInputControl onFinalTranscript={onFinal} />);
    });

    const button = container.querySelector('button') as HTMLButtonElement;

    // Rapid repeated clicks while start() is pending asynchronously
    await act(async () => {
      button.click();
      button.click();
      button.click();
    });

    // Only ONE instance should have been created and started
    expect(MockSpeechRecognition.instances.length).toBe(1);
    const session = MockSpeechRecognition.instances[0];
    expect(session.start).toHaveBeenCalledTimes(1);

    // Now browser speech recognition actually starts and fires onstart
    await act(async () => {
      session.onstart?.();
    });

    expect(button.getAttribute('aria-label')).toBe('Stop voice input');
    expect(button.getAttribute('aria-pressed')).toBe('true');

    // Subsequent click now cleanly stops the session
    await act(async () => {
      button.click();
    });

    expect(session.stop).toHaveBeenCalledTimes(1);
  });

  it('discards delayed onresult callbacks from a previously closed session', async () => {
    const onFinal = vi.fn();
    await act(async () => {
      root.render(<VoiceInputControl onFinalTranscript={onFinal} />);
    });

    const button = container.querySelector('button') as HTMLButtonElement;

    // Start session 1
    await act(async () => {
      button.click();
    });
    const session1 = MockSpeechRecognition.instances[0];

    // Stop session 1 (triggers onend, closing session 1)
    await act(async () => {
      button.click();
    });

    // Delayed result from session 1 arrives AFTER session 1 was ended/closed
    await act(async () => {
      session1.onresult?.({
        resultIndex: 0,
        results: [
          {
            isFinal: true,
            0: { transcript: 'stale text after end' },
          },
        ],
      } as unknown as Event);
    });

    expect(onFinal).not.toHaveBeenCalled();
  });

  it('discards results from an old session after a newer session starts', async () => {
    const onFinal = vi.fn();
    await act(async () => {
      root.render(<VoiceInputControl onFinalTranscript={onFinal} />);
    });

    const button = container.querySelector('button') as HTMLButtonElement;

    // Start session 1
    await act(async () => {
      button.click();
    });
    const session1 = MockSpeechRecognition.instances[0];

    // Stop session 1
    await act(async () => {
      button.click();
    });

    // Start session 2
    await act(async () => {
      button.click();
    });
    const session2 = MockSpeechRecognition.instances[1];

    // Delayed result arrives from session 1
    await act(async () => {
      session1.onresult?.({
        resultIndex: 0,
        results: [
          {
            isFinal: true,
            0: { transcript: 'stale speech from session 1' },
          },
        ],
      } as unknown as Event);
    });

    // Should NOT accept session 1's delayed transcript
    expect(onFinal).not.toHaveBeenCalled();

    // Valid speech arrives from session 2
    await act(async () => {
      session2.onresult?.({
        resultIndex: 0,
        results: [
          {
            isFinal: true,
            0: { transcript: 'valid speech from session 2' },
          },
        ],
      } as unknown as Event);
    });

    expect(onFinal).toHaveBeenCalledTimes(1);
    expect(onFinal).toHaveBeenCalledWith('valid speech from session 2');
  });

  it('ignores delayed onend from an old session arriving after a new session starts', async () => {
    // Disable autoEndOnStop so onend does not fire immediately on stop
    MockSpeechRecognition.autoEndOnStop = false;

    const onInterim = vi.fn();
    await act(async () => {
      root.render(
        <VoiceInputControl
          onFinalTranscript={vi.fn()}
          onInterimTranscript={onInterim}
        />
      );
    });

    const button = container.querySelector('button') as HTMLButtonElement;

    // Start session 1
    await act(async () => {
      button.click();
    });
    const session1 = MockSpeechRecognition.instances[0];

    // Stop session 1 (onend is delayed)
    await act(async () => {
      button.click();
    });

    // Start session 2
    await act(async () => {
      button.click();
    });
    const session2 = MockSpeechRecognition.instances[1];
    expect(button.getAttribute('aria-label')).toBe('Stop voice input');
    expect(button.getAttribute('aria-pressed')).toBe('true');

    // Emit interim on session 2
    await act(async () => {
      session2.onresult?.({
        resultIndex: 0,
        results: [
          {
            isFinal: false,
            0: { transcript: 'active session 2 interim' },
          },
        ],
      } as unknown as Event);
    });
    expect(onInterim).toHaveBeenLastCalledWith('active session 2 interim');

    // Session 1's delayed onend arrives
    await act(async () => {
      session1.onend?.();
    });

    // Session 2 should STILL be listening and active
    expect(button.getAttribute('aria-label')).toBe('Stop voice input');
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });

  it('preserves legitimate final speech results arriving after user stops dictation before onend', async () => {
    // Disable autoEndOnStop so onend does not fire immediately, allowing buffered results to flush
    MockSpeechRecognition.autoEndOnStop = false;

    const onFinal = vi.fn();
    await act(async () => {
      root.render(<VoiceInputControl onFinalTranscript={onFinal} />);
    });

    const button = container.querySelector('button') as HTMLButtonElement;

    // Start dictation
    await act(async () => {
      button.click();
    });
    const session = MockSpeechRecognition.instances[0];

    // User explicitly clicks to stop dictation
    await act(async () => {
      button.click();
    });
    expect(session.stop).toHaveBeenCalled();

    // Browser delivers final speech chunk before onend
    await act(async () => {
      session.onresult?.({
        resultIndex: 0,
        results: [
          {
            isFinal: true,
            0: { transcript: 'final words spoken before stop' },
          },
        ],
      } as unknown as Event);
    });

    // Legitimate final chunk must be preserved
    expect(onFinal).toHaveBeenCalledWith('final words spoken before stop');

    // Now onend arrives
    await act(async () => {
      session.onend?.();
    });

    // Any late result arriving after onend is discarded
    await act(async () => {
      session.onresult?.({
        resultIndex: 1,
        results: [
          {
            isFinal: true,
            0: { transcript: 'ignored after onend' },
          },
        ],
      } as unknown as Event);
    });
    expect(onFinal).toHaveBeenCalledTimes(1);
  });

  it('stops recognition during submission and ignores late speech results', async () => {
    const onFinal = vi.fn();
    const onInterim = vi.fn();

    await act(async () => {
      root.render(
        <VoiceInputControl
          disabled={false}
          onFinalTranscript={onFinal}
          onInterimTranscript={onInterim}
        />
      );
    });

    const button = container.querySelector('button') as HTMLButtonElement;
    await act(async () => {
      button.click();
    });
    const session = MockSpeechRecognition.instances[0];

    // Submission begins (disabled becomes true)
    await act(async () => {
      root.render(
        <VoiceInputControl
          disabled={true}
          onFinalTranscript={onFinal}
          onInterimTranscript={onInterim}
        />
      );
    });

    expect(session.stop).toHaveBeenCalled();
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('false');

    // Late speech result arrives during submission
    await act(async () => {
      session.onresult?.({
        resultIndex: 0,
        results: [
          {
            isFinal: true,
            0: { transcript: 'should not mutate submitted report' },
          },
        ],
      } as unknown as Event);
    });

    expect(onFinal).not.toHaveBeenCalled();
  });

  it('ignores callbacks that arrive after unmount and aborts active recognition', async () => {
    const onFinal = vi.fn();
    await act(async () => {
      root.render(<VoiceInputControl onFinalTranscript={onFinal} />);
    });

    const button = container.querySelector('button') as HTMLButtonElement;
    await act(async () => {
      button.click();
    });
    const session = MockSpeechRecognition.instances[0];

    // Unmount
    await act(async () => {
      root.unmount();
    });
    expect(session.abort).toHaveBeenCalled();

    // Callbacks firing after unmount should not throw or invoke handlers
    await act(async () => {
      session.onresult?.({
        resultIndex: 0,
        results: [
          {
            isFinal: true,
            0: { transcript: 'post-unmount speech' },
          },
        ],
      } as unknown as Event);
      session.onerror?.({ error: 'network' } as unknown as Event);
      session.onend?.();
    });

    expect(onFinal).not.toHaveBeenCalled();
  });
});
