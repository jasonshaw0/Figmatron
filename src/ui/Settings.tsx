import { useState } from 'react';
import { Settings as SettingsIcon, X } from 'lucide-react';

interface Props {
  apiKey: string;
  setApiKey: (k: string) => void;
  model: string;
  setModel: (m: string) => void;
}

export default function Settings({ apiKey, setApiKey, model, setModel }: Props) {
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
        
        <p style={{ fontSize: '0.75rem', opacity: 0.7, marginBottom: '16px' }}>
          API Keys are currently stored locally in the plugin state during design dev mode.
        </p>
      </div>
    </div>
  );
}
