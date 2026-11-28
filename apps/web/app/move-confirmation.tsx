import { useEffect, useRef, useState } from 'react';
import { post } from './drive-api';

export type MoveRequest = {
  item: { id: string; name: string };
  source: { id: string; path: string };
  destination: { id: string; path: string };
};

export function MoveConfirmation({
  move,
  cancel,
  moved,
}: {
  move: MoveRequest;
  cancel: () => void;
  moved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    const d = dialog.current!;
    d.showModal();
    return () => d.close();
  }, []);
  async function submit() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      await post('entries/' + move.item.id + '/move', {
        parent: move.destination.id,
        expectedParent: move.source.id,
      });
      moved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="entry-dialog move-confirm"
      aria-labelledby="move-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) cancel();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 id="move-title">항목을 이동할까요?</h2>
        <p className="item-context">{move.item.name}</p>
        <dl>
          <dt>현재 위치</dt>
          <dd>{move.source.path}</dd>
          <dt>이동할 위치</dt>
          <dd>{move.destination.path}</dd>
        </dl>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button type="button" autoFocus disabled={busy} onClick={cancel}>
            취소
          </button>
          <button type="submit" disabled={busy} className="primary">
            이동 확인
          </button>
        </footer>
      </form>
    </dialog>
  );
}
