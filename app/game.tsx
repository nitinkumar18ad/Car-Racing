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
          <div className="mode-row"><span className="label">Mode</span><button id="mode-button" className="mode-button" type="button">Circuit</button></div>
          <div className="lap-row"><span id="lap-label" className="label">Lap</span><span className="lap-count"><b id="lap-current">1</b><i>/</i><span id="lap-total">3</span></span></div>
          <div id="time-current" className="time-big">0:00.000</div>
          <div className="time-row"><span>LAST</span><span id="time-last">--</span></div>
          <div className="time-row"><span>BEST</span><span id="time-best">--</span></div>
          <div id="delta" className="delta" />
        </div>
        <div className="panel panel-map"><canvas id="minimap" aria-label="Track map" /></div>
        <div className="panel panel-speed">
          <svg className="gauge" viewBox="0 0 240 190" aria-hidden="true"><g id="gauge-ticks" className="gauge-ticks" /><g id="gauge-numbers" className="gauge-numbers" /><line id="gauge-needle" className="gauge-needle" x1="120" y1="140" x2="120" y2="48" /><circle className="gauge-hub-outer" cx="120" cy="140" r="15" /><circle className="gauge-hub-inner" cx="120" cy="140" r="8" /></svg>
          <div className="speed-readout"><span id="speed-value">000</span><small>KM/H</small></div><div id="gear" className="gear">N</div>
        </div>
        <div className="panel panel-keys"><div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> DRIVE</div><div><kbd>SPACE</kbd> DRIFT</div><div><kbd>M</kbd> MODE <kbd>C</kbd> CAMERA <kbd>R</kbd> RESTART</div></div>
        <div id="offroad" className="offroad">OFF TRACK</div>
      </div>
      <div id="countdown" className="hidden"><span id="countdown-text">3</span></div>
      <div id="paused" className="overlay hidden"><div className="card"><h2>PAUSED</h2><p>Press P or Escape to resume</p></div></div>
      <div id="results" className="overlay hidden"><div className="card"><h2 id="results-title">RACE COMPLETE</h2><table className="results-table"><tbody id="results-rows" /></table><div className="results-total"><span>TOTAL</span><span id="results-total">--</span></div><div id="results-best" className="results-best" /><p className="results-hint">Press R to race again</p></div></div>
      <div id="fatal" className="overlay hidden" role="alert"><div className="card"><h2>UNABLE TO START</h2><p id="fatal-message" /></div></div>
    </main>
  );
}
