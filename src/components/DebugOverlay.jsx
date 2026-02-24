import React, { useState, useEffect, useRef, useCallback } from 'react';

/**
 * DebugOverlay — On-screen console log viewer for devices without
 * developer tools (e.g. Apple Vision Pro). Captures console.log,
 * console.warn, console.error and displays them in a floating panel.
 *
 * Toggle visibility with the small "DBG" button in the bottom-right corner.
 */
export default function DebugOverlay() {
  const [logs, setLogs] = useState([]);
  const [visible, setVisible] = useState(false);
  const [filter, setFilter] = useState('all'); // 'all' | 'error' | 'warn'
  const scrollRef = useRef(null);
  const maxLogs = 200;

  useEffect(() => {
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;

    const addEntry = (level, args) => {
      const text = args
        .map((a) => {
          if (typeof a === 'string') return a;
          try { return JSON.stringify(a, null, 1); }
          catch { return String(a); }
        })
        .join(' ');
      const entry = { id: Date.now() + Math.random(), level, text, time: new Date().toLocaleTimeString() };
      setLogs((prev) => {
        const next = [...prev, entry];
        return next.length > maxLogs ? next.slice(-maxLogs) : next;
      });
    };

    console.log = (...args) => { origLog.apply(console, args); addEntry('log', args); };
    console.warn = (...args) => { origWarn.apply(console, args); addEntry('warn', args); };
    console.error = (...args) => { origError.apply(console, args); addEntry('error', args); };

    // Capture unhandled errors
    const onError = (e) => addEntry('error', [`[Uncaught] ${e.message} at ${e.filename}:${e.lineno}`]);
    const onRejection = (e) => addEntry('error', [`[UnhandledRejection] ${e.reason}`]);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);

    return () => {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current && visible) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, visible]);

  const filtered = filter === 'all' ? logs : logs.filter((l) => l.level === filter);

  const levelColor = { log: '#aaa', warn: '#f5a623', error: '#ff4444' };

  const clearLogs = useCallback(() => setLogs([]), []);

  return (
    <>
      {/* Toggle button — always visible */}
      <button
        onClick={() => setVisible((v) => !v)}
        style={{
          position: 'fixed',
          bottom: 12,
          right: 12,
          zIndex: 99999,
          background: visible ? '#007AFF' : 'rgba(0,0,0,0.6)',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          padding: '4px 10px',
          fontSize: 11,
          fontFamily: 'monospace',
          fontWeight: 'bold',
          cursor: 'pointer',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          touchAction: 'manipulation',
        }}
      >
        DBG
      </button>

      {/* Console panel */}
      {visible && (
        <div
          style={{
            position: 'fixed',
            bottom: 44,
            right: 12,
            width: 420,
            maxWidth: 'calc(100vw - 24px)',
            height: 320,
            zIndex: 99999,
            background: 'rgba(0,0,0,0.88)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.15)',
            display: 'flex',
            flexDirection: 'column',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 11,
            color: '#ccc',
            overflow: 'hidden',
            touchAction: 'manipulation',
          }}
        >
          {/* Toolbar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              borderBottom: '1px solid rgba(255,255,255,0.1)',
              flexShrink: 0,
            }}
          >
            <span style={{ fontWeight: 'bold', color: '#fff', marginRight: 'auto' }}>Console</span>
            {['all', 'error', 'warn'].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  background: filter === f ? 'rgba(255,255,255,0.2)' : 'transparent',
                  color: f === 'error' ? '#ff4444' : f === 'warn' ? '#f5a623' : '#aaa',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 4,
                  padding: '2px 8px',
                  fontSize: 10,
                  cursor: 'pointer',
                  touchAction: 'manipulation',
                }}
              >
                {f}
              </button>
            ))}
            <button
              onClick={clearLogs}
              style={{
                background: 'transparent',
                color: '#888',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 4,
                padding: '2px 8px',
                fontSize: 10,
                cursor: 'pointer',
                touchAction: 'manipulation',
              }}
            >
              clear
            </button>
          </div>

          {/* Log entries */}
          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '4px 10px' }}>
            {filtered.length === 0 && (
              <div style={{ color: '#555', padding: 8, textAlign: 'center' }}>No logs yet</div>
            )}
            {filtered.map((entry) => (
              <div
                key={entry.id}
                style={{
                  padding: '3px 0',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  wordBreak: 'break-all',
                  color: levelColor[entry.level],
                }}
              >
                <span style={{ color: '#555', marginRight: 6 }}>{entry.time}</span>
                {entry.level !== 'log' && (
                  <span style={{ color: levelColor[entry.level], fontWeight: 'bold', marginRight: 4 }}>
                    [{entry.level}]
                  </span>
                )}
                {entry.text}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
