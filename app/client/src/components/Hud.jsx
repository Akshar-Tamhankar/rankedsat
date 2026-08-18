import React from 'react';

const TOGGLES = [
  ['blur', 'Translucency'],
  ['ambient', 'Ambient FX'],
  ['sound', 'Sound'],
  ['fps', 'Measure FPS'],
];

export default function Hud({ fps, prefs, setPrefs }) {
  return (
    <div className="hud" onClick={(e) => e.stopPropagation()}>
      <div className="fps"><span>FPS</span><b>{prefs.fps ? fps || '—' : '—'}</b></div>
      <div className="sep" />
      {TOGGLES.map(([k, label]) => (
        <label key={k}>
          <input
            type="checkbox"
            checked={prefs[k]}
            onChange={(e) => setPrefs((p) => ({ ...p, [k]: e.target.checked }))}
          />
          {label}
        </label>
      ))}
    </div>
  );
}
