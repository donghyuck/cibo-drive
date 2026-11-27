import { useEffect, useRef, useState } from 'react';
import {
  ArrowRightLeft,
  Eye,
  Folder,
  Pencil,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { api, post } from './drive-api';

export type DriveItem = {
  id: string;
  name: string;
  folder: boolean;
  location?: string[];
  trashed_at?: string;
};
type Action = 'rename' | 'move' | 'trash' | 'restore';
const titles = {
  rename: '이름 변경',
  move: '이동',
  trash: '휴지통으로 이동',
  restore: '복원',
};

export function EntryTools({
  item,
  restore,
  close,
  changed,
}: {
  item: DriveItem;
  restore: boolean;
  close: () => void;
  changed: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [action, setAction] = useState<Action>(restore ? 'restore' : 'rename');
  const [name, setName] = useState(item.name),
    [parent, setParent] = useState('');
  const [folders, setFolders] = useState<{ id: string; path: string[] }[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    return () => d.close();
  }, []);
  useEffect(() => {
    if (action !== 'move') return;
    let alive = true;
    api('destinations/' + item.id)
      .then((rows) => {
        if (alive) setFolders(rows);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [action, item.id]);
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await post(
        'entries/' + item.id + '/' + action,
        action === 'move' ? { parent } : action === 'trash' ? {} : { name },
      );
      changed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className="entry-dialog"
      aria-labelledby="entry-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <header>
          <h2 id="entry-title">{restore ? '휴지통에서 복원' : '항목 관리'}</h2>
          <button
            className="icon"
            type="button"
            aria-label="닫기"
            disabled={busy}
            onClick={close}
          >
            <X />
          </button>
        </header>
        <p className="item-context">{item.name}</p>
        {!restore && (
          <div className="entry-actions">
            {(['rename', 'move', 'trash'] as const).map((a) => (
              <button
                type="button"
                disabled={busy}
                key={a}
                aria-pressed={action === a}
                onClick={() => {
                  setAction(a);
                  setError('');
                }}
              >
                {a === 'rename' ? (
                  <Pencil />
                ) : a === 'move' ? (
                  <ArrowRightLeft />
                ) : (
                  <Trash2 />
                )}
                {a === 'trash' ? '휴지통' : titles[a]}
              </button>
            ))}
          </div>
        )}
        {(action === 'rename' || action === 'restore') && (
          <label>
            {restore ? '복원할 이름' : '새 이름'}
            <input
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}
        {action === 'move' && (
          <label>
            대상 폴더
            <select
              required
              value={parent}
              onChange={(e) => setParent(e.target.value)}
            >
              <option value="">폴더 선택</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.path.join(' / ')}
                </option>
              ))}
            </select>
          </label>
        )}
        {action === 'trash' && (
          <p>
            {item.folder
              ? '이 폴더와 하위 항목을 휴지통으로 이동합니다.'
              : '이 파일을 휴지통으로 이동합니다.'}{' '}
            복원하기 전까지 기존 링크로 열 수 없습니다.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <footer>
          <button type="button" disabled={busy} onClick={close}>
            취소
          </button>
          <button
            className="primary"
            disabled={busy || (action === 'move' ? !parent : !name.trim())}
          >
            {titles[action]}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

export function SpaceLookup({
  mode,
  writable,
  close,
  refreshKey,
  manage,
  preview,
}: {
  mode: 'search' | 'trash';
  writable: boolean;
  close: () => void;
  refreshKey: number;
  manage: (item: DriveItem) => void;
  preview: (item: DriveItem) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState(''),
    [items, setItems] = useState<DriveItem[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  const trash = mode === 'trash';
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    return () => d.close();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setItems([]);
    if (!trash && !query.trim()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(
      async () => {
        try {
          const result = await api(
            trash
              ? 'trash'
              : 'search?' + new URLSearchParams({ q: query.trim() }),
            { signal: controller.signal },
          );
          if (!controller.signal.aborted) setItems(result);
        } catch (e) {
          if (!controller.signal.aborted) setError((e as Error).message);
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      },
      trash ? 0 : 180,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, trash, refreshKey]);
  return (
    <dialog
      ref={ref}
      className="lookup"
      aria-label={trash ? '휴지통' : '전체 공간 검색'}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header>
        <h2>{trash ? '휴지통' : '전체 공간 검색'}</h2>
        <button className="icon" aria-label="닫기" onClick={close}>
          <X />
        </button>
      </header>
      {!trash && (
        <label>
          파일명
          <input
            autoFocus
            type="search"
            maxLength={200}
            placeholder="모든 폴더에서 파일 찾기"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      )}
      {error ? (
        <p role="alert">{error}</p>
      ) : loading ? (
        <p role="status">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p>
          {trash
            ? '휴지통이 비어 있습니다.'
            : query.trim()
              ? '일치하는 파일이 없습니다.'
              : '찾을 파일 이름을 입력하세요.'}
        </p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <div>
                {trash ? (
                  <strong>
                    {item.folder && <Folder size={15} />} {item.name}
                  </strong>
                ) : (
                  <button className="result-name" onClick={() => preview(item)}>
                    <Eye />
                    {item.name}
                  </button>
                )}
                <small>
                  {item.location?.join(' / ') ??
                    (item.trashed_at
                      ? new Date(item.trashed_at).toLocaleString('ko-KR')
                      : null)}
                </small>
              </div>
              {writable && (
                <button
                  aria-label={item.name + (trash ? ' 복원' : ' 관리')}
                  onClick={() => manage(item)}
                >
                  {trash ? <RotateCcw /> : <Pencil />}
                  {trash ? '복원' : '관리'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </dialog>
  );
}
