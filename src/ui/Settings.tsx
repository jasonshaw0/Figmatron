import { useState } from 'react';
import { Settings as SettingsIcon, X } from 'lucide-react';
import type { RouteOverride } from '../shared/protocol';

interface Props {
  apiKey: string;
  setApiKey: (k: string) => void;
  model: string;
  setModel: (m: string) => void;
  debugMode: boolean;
  setDebugMode: (value: boolean) => void;
  autoScreenshotModify: boolean;
  setAutoScreenshotModify: (value: boolean) => void;
  screenshotForCreateAsk: boolean;
  setScreenshotForCreateAsk: (value: boolean) => void;
  routeOverride: RouteOverride;
  setRouteOverride: (value: RouteOverride) => void;
}

export default function Settings({
  apiKey,
  setApiKey,
  model,
  setModel,
  debugMode,
  setDebugMode,
  autoScreenshotModify,
  setAutoScreenshotModify,
  screenshotForCreateAsk,
  setScreenshotForCreateAsk,
  routeOverride,
  setRouteOverride
}: Props) {
  const [isOpen, setIsOpen] = useState(false);

  if (!isOpen) {
    return (
      <button 
        onClick={() => setIsOpen(true)} 
        className="icon-button"
        style={{ position: 'absolute', top: '16px', right: '16px' }}
      >
        <SettingsIcon size={20} />
      </button>
    );
  }

  return (
    <div className="settings-modal bg-primary text-primary" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10, padding: '16px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 className="text-brand" style={{ margin: 0, fontSize: '1.25rem' }}>Settings</h2>
        <button onClick={() => setIsOpen(false)} className="icon-button">
          <X size={20} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: 500 }}>
          Gemini API Key
        </label>
        <input 
          type="password" 
          value={apiKey} 
          onChange={e => setApiKey(e.target.value)} 
          className="input" 
          style={{ width: '100%', boxSizing: 'border-box', marginBottom: '16px' }}
          placeholder="AIzaSy..."
        />

        <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: 500 }}>
          Model
        </label>
        <select 
          value={model}
          onChange={e => setModel(e.target.value)}
          className="input"
          style={{ width: '100%', boxSizing: 'border-box', marginBottom: '16px' }}
        >
          <option value="gemini-3-flash-preview">gemini-3-flash-preview</option>
          <option value="gemini-3-pro-preview">gemini-3-pro-preview</option>
          <option value="gemini-2.5-flash">gemini-2.5-flash</option>
        </select>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', fontSize: '0.875rem' }}>
          <input
            type="checkbox"
            checked={autoScreenshotModify}
            onChange={e => setAutoScreenshotModify(e.target.checked)}
          />
          Auto-include screenshot in Modify mode
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', fontSize: '0.875rem' }}>
          <input
            type="checkbox"
            checked={screenshotForCreateAsk}
            onChange={e => setScreenshotForCreateAsk(e.target.checked)}
          />
          Include screenshot in Create/Ask mode
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', fontSize: '0.875rem' }}>
          <input
            type="checkbox"
            checked={debugMode}
            onChange={e => setDebugMode(e.target.checked)}
          />
          Enable debug panel
        </label>

        {debugMode && (
          <>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: 500 }}>
              Route Override
            </label>
            <select
              value={routeOverride}
              onChange={e => setRouteOverride(e.target.value as RouteOverride)}
              className="input"
              style={{ width: '100%', boxSizing: 'border-box', marginBottom: '16px' }}
            >
              <option value="auto">auto</option>
              <option value="direct_svg">direct_svg</option>
              <option value="structured_ir">structured_ir</option>
            </select>
          </>
        )}

        <p style={{ fontSize: '0.75rem', opacity: 0.7, marginBottom: '16px' }}>
          Settings and keys are stored locally in browser localStorage for this plugin UI.
        </p>
      </div>
    </div>
  );
}
