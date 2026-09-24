/**
 * MB-07. Share codes — export (deflate+base64url, versioned) and import (validate→preview→save).
 *
 * Export only validated tracks. Shows copy button + link (origin?share=CODE).
 * Optional short code (8 hex) via appStorage.
 * Import: paste code → decodeShareCode → validate → preview via TrackThumbnail → Save to My tracks.
 */
import { useState } from 'react';
import { Copy, Link2, ShieldCheck, ShieldAlert, Download, Upload, Check, AlertTriangle, ExternalLink, Ruler } from 'lucide-react';
import TrackThumbnail from './TrackThumbnail';
import { encodeShareCode, decodeShareCode, registerShortCode, ShareCodeError } from '../../game/sharecode';
import type { TrackDef } from '../../game/trackdef';
import type { ValidationResult } from './validate';
import { formatUnits } from './camera';

interface Props {
  def: TrackDef;
  validation: ValidationResult | null;
  validating: boolean;
  onImport: (def: TrackDef) => void;
}

export default function SharePanel({ def, validation, validating, onImport }: Props) {
  const [exporting, setExporting] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [shortCode, setShortCode] = useState<string | null>(null);
  const [shortBusy, setShortBusy] = useState(false);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [importCode, setImportCode] = useState('');
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<TrackDef | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const canExport = !!validation?.canShare;

  const handleExport = async () => {
    if (!canExport) return;
    setExporting(true);
    setCode(null);
    setShortCode(null);
    setCopyMsg(null);
    try {
      const c = await encodeShareCode(def);
      setCode(c);
    } catch (e) {
      setCopyMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyMsg('Copied to clipboard');
      setTimeout(() => setCopyMsg(null), 2500);
    } catch {
      setCopyMsg(text.slice(0,120));
    }
  };

  const handleMakeShort = async () => {
    if (!code) return;
    setShortBusy(true);
    try {
      const sc = await registerShortCode(def);
      setShortCode(sc);
      setCopyMsg(`Short code ${sc} saved to cloud (appStorage). Share the 8 chars!`);
    } catch (e) {
      setCopyMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setShortBusy(false);
    }
  };

  const handleImport = async () => {
    const raw = importCode.trim();
    if (!raw) { setImportError('Paste a share code first.'); return; }
    setImporting(true);
    setImportError(null);
    setImported(null);
    try {
      const decoded = await decodeShareCode(raw);
      setImported(decoded);
    } catch (e) {
      const msg = e instanceof ShareCodeError ? e.message : (e instanceof Error ? e.message : String(e));
      setImportError(msg);
    } finally {
      setImporting(false);
    }
  };

  const handleSaveImported = () => {
    if (!imported) return;
    onImport(imported);
    setImported(null);
    setImportCode('');
    setCopyMsg(`Imported “${imported.name}” — saved to My tracks.`);
    setTimeout(() => setCopyMsg(null), 3000);
  };

  const shareLink = code ? `${typeof window !== 'undefined' ? window.location.origin : ''}${typeof window !== 'undefined' ? window.location.pathname : ''}?share=${encodeURIComponent(code)}` : '';

  return (
    <div className="share-panel">
      <header className="share-head">
        <span className="eyebrow"><b>05</b> SHARE CODES</span>
      </header>

      {/* Export */}
      <div className="share-section">
        <div className="share-section-head">
          <Upload size={12} /> Export
          {validation && (
            <span className={`share-badge ${canExport ? 'is-pass' : 'is-fail'}`}>
              {canExport ? <ShieldCheck size={10} /> : <ShieldAlert size={10} />}
              {canExport ? 'Ready to export' : 'Fix errors first'}
            </span>
          )}
        </div>
        {!canExport ? (
          validating ? <p className="prop-empty">Validating…</p> : null
        ) : (
          <>
            <button className="button-primary share-export-btn" onClick={handleExport} disabled={exporting}>
              {exporting ? 'Encoding…' : <><Link2 size={13} /> Generate share code</>}
            </button>
            {code && (
              <div className="share-code-box">
                <div className="share-code-head">
                  <span>Share code ({code.length} chars)</span>
                  <button className="icon-button" onClick={() => handleCopy(code)} title="Copy code"><Copy size={12} /></button>
                </div>
                <textarea readOnly value={code} rows={3} className="share-code-text" onFocus={(e) => e.target.select()} />
                <div className="share-code-actions">
                  <button className="button-secondary" onClick={() => handleCopy(code)}><Copy size={12} /> Copy code</button>
                  <button className="button-secondary" onClick={() => handleCopy(shareLink)}><ExternalLink size={12} /> Copy link</button>
                  <button className="button-secondary" onClick={handleMakeShort} disabled={shortBusy}>{shortBusy ? '…' : 'Make 8-char short code'}</button>
                </div>
                {shareLink && <p className="share-link-preview">Link: <span className="share-link-text">{shareLink.slice(0,80)}…</span></p>}
                {shortCode && (
                  <div className="share-short">
                    <span className="share-short-label">Short code:</span>
                    <code className="share-short-code">{shortCode}</code>
                    <button className="icon-button" onClick={() => handleCopy(shortCode)} title="Copy short code"><Copy size={12} /></button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Import */}
      <div className="share-section">
        <div className="share-section-head"><Download size={12} /> Import</div>
        <div className="share-import-row">
          <input
            className="share-import-input"
            placeholder="Paste share code (1-… or 8-char short)…"
            value={importCode}
            onChange={(e) => setImportCode(e.target.value)}
            aria-label="Paste share code"
          />
          <button className="button-primary" onClick={handleImport} disabled={importing || !importCode.trim()}>
            {importing ? 'Checking…' : 'Preview'}
          </button>
        </div>
        {importError && <p className="share-error" role="alert"><AlertTriangle size={12} />{importError}</p>}
        {imported && (
          <div className="share-preview">
            <TrackThumbnail def={imported} />
            <div className="share-preview-meta">
              <strong>{imported.name}</strong>
              <span className="share-preview-stat"><Ruler size={10} />{formatUnits(imported.height)} u</span>
              <span className="share-preview-stat">{imported.pieces.length} pieces · {imported.theme}</span>
              <span className="share-preview-valid"><ShieldCheck size={10} /> Validated (MB-01) — ready to save</span>
              <button className="button-primary" onClick={handleSaveImported}><Check size={12} /> Save to My tracks</button>
            </div>
          </div>
        )}
      </div>

      {copyMsg && <p className="share-msg"><Check size={10} />{copyMsg}</p>}
    </div>
  );
}
