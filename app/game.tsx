'use client';

import { useEffect } from 'react';

export default function Game() {
  useEffect(() => {
    void import('../js/main');
  }, []);

  return (
    <main className="min-h-[100dvh] overflow-hidden bg-[#0a0d12] text-slate-100">
      <canvas id="scene" aria-label="3D racing circuit" />
      <div id="loading" className="overlay" role="status" aria-live="polite">
        <div className="loading-inner">
          <div className="loading-title">APEX CIRCUIT</div>
          <div className="loading-bar"><span /></div>
          <div className="loading-note">loading circuit</div>
        </div>
      </div>
      <div id="hud" className="hidden" aria-live="polite">
        <div className="panel panel-timing">
          <div className="mode-row">
            <span className="label">Mode</span>
            <div className="mode-actions">
              <button id="mode-button" className="mode-button" type="button">Time Lap</button>
              <button id="audio-button" className="audio-button" type="button" aria-label="Toggle sound (U)" title="Toggle sound (U)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>
              </button>
            </div>
          </div>
          <div className="lap-row"><span id="lap-label" className="label">Run</span><span className="lap-count"><b id="lap-current">1</b><i>/</i><span id="lap-total">1</span></span></div>
          <div id="time-current" className="time-big">0:00.000</div>
          <div className="time-row"><span>LAST</span><span id="time-last">--</span></div>
          <div className="time-row"><span>BEST</span><span id="time-best">--</span></div>
          <div id="delta" className="delta" />
        </div>
        <div className="panel panel-map"><canvas id="minimap" aria-label="Track map" /></div>
        <div className="panel panel-speed">
          <div className="speed-main">
            <div id="gear" className="gear">N</div>
            <div className="speed-readout">
              <span id="speed-value">0</span>
              <small>KM/H</small>
            </div>
          </div>
          <div className="speed-bar"><div id="speed-bar-fill" className="speed-bar-fill" /></div>
        </div>
        <div className="panel panel-keys">
          <div className="keys-row">
            <span className="keys-group"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span className="key-label">Drive</span></span>
            <span className="keys-dot">•</span>
            <span className="keys-group"><kbd>Space</kbd><span className="key-label">Drift</span></span>
          </div>
          <div className="keys-row">
            <span className="keys-group"><kbd>C</kbd><span className="key-label">Cam</span></span>
            <span className="keys-dot">•</span>
            <span className="keys-group"><kbd>M</kbd><span className="key-label">Mode</span></span>
            <span className="keys-dot">•</span>
            <span className="keys-group"><kbd>U</kbd><span className="key-label">Sound</span></span>
            <span className="keys-dot">•</span>
            <span className="keys-group"><kbd>R</kbd><span className="key-label">Reset</span></span>
          </div>
        </div>
        <div id="offroad" className="offroad">OFF TRACK</div>
      </div>
      <div id="countdown" className="hidden"><span id="countdown-text">3</span></div>
      <div id="paused" className="overlay hidden"><div className="card"><h2>PAUSED</h2><p>Press P or Escape to resume</p></div></div>
      <div id="results" className="overlay hidden"><div className="card"><h2 id="results-title">RACE COMPLETE</h2><table className="results-table"><tbody id="results-rows" /></table><div className="results-total"><span>TOTAL</span><span id="results-total">--</span></div><div id="results-best" className="results-best" /><p className="results-hint">Press R to race again</p></div></div>
      <div id="fatal" className="overlay hidden" role="alert"><div className="card"><h2>UNABLE TO START</h2><p id="fatal-message" /></div></div>
    </main>
  );
}
