/**
 * An in-game yes/no dialog. The game runs inside RUN.world's frame, where the browser's own `confirm()` and
 * `alert()` are blocked — `confirm()` quietly answers "no" — so every confirmation goes through this instead.
 */
import Dialog from './Dialog';

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: Props) {
  return <Dialog titleId="confirm-dialog-title" onClose={onCancel} className="clear-map-dialog">
    <h2 id="confirm-dialog-title">{title}</h2>
    <p className="dialog-intro">{message}</p>
    <div className="pause-actions">
      <button className="button-secondary" onClick={onCancel} autoFocus>Cancel</button>
      <button className="button-primary" onClick={onConfirm}>{confirmLabel}</button>
    </div>
  </Dialog>;
}
