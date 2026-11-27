import { useEffect, useRef, useState } from 'react';
import {
  Eye,
  Ellipsis,
  Trash2,
  ArrowDownAZ,
  ArrowUpZA,
  ChevronRight,
  FileText,
  Folder as FolderIcon,
  FolderPlus,
  HardDrive,
  LayoutGrid,
  Layers3,
  List,
  Search,
  Upload,
  X,
} from 'lucide-react';
import { EntryTools, SpaceLookup, type DriveItem } from './entry-tools';
import { FilePreview } from './file-preview';
import { api, post } from './drive-api';

export type Folder = {
  current: { id: string; name: string; parent_id: string | null };
  entries: { id: string; name: string; folder: boolean }[];
};
function fileType(entry: Folder['entries'][number]) {
  if (entry.folder) return '폴더';
  return entry.name.split('.').pop()?.toUpperCase() || '파일';
}

export function FileBrowser({
  initial,
  writable,
}: {
  initial: Folder;
  writable: boolean;
}) {
  const [folder, setFolder] = useState(initial);
  const [trail, setTrail] = useState([initial.current]);
  const [preview, setPreview] = useState<Folder['entries'][number] | null>(
    null,
  );
  const [lookup, setLookup] = useState<'search' | 'trash' | null>(null);
  const [managed, setManaged] = useState<DriveItem | null>(null);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('전체');
  const [descending, setDescending] = useState(false);
  const [grid, setGrid] = useState(true);
  useEffect(() => {
    try {
      setGrid(localStorage.getItem('cibo-view') !== 'list');
    } catch {}
  }, []);
  function chooseView(cards: boolean) {
    setGrid(cards);
    try {
      localStorage.setItem('cibo-view', cards ? 'grid' : 'list');
    } catch {}
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dragging, setDragging] = useState(false);
  const [name, setName] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const current = folder.current;
  async function perform(work: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const read = (id: string): Promise<Folder> =>
    api('folder?id=' + encodeURIComponent(id));
  function navigate(id: string) {
    void perform(async () => {
      const next = await read(id),
        index = trail.findIndex((item) => item.id === id);
      setFolder(next);
      setTrail(
        index < 0 ? [...trail, next.current] : trail.slice(0, index + 1),
      );
      setQuery('');
      setFilter('전체');
    });
  }
  function upload(files: File[]) {
    if (!writable || !files.length) return;
    void perform(async () => {
      let count = 0;
      try {
        for (const file of files) {
          setNotice(file.name + ' 업로드 중…');
          try {
            await api(
              'files?' +
                new URLSearchParams({ parent: current.id, name: file.name }),
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: file,
              },
            );
          } catch (e) {
            throw new Error(file.name + ' · ' + (e as Error).message);
          }
          count++;
        }
      } finally {
        setNotice(count ? count + '개 파일을 업로드했습니다.' : '');
        if (count) {
          setQuery('');
          setFilter('전체');
          setFolder(await read(current.id));
        }
      }
    });
  }
  const visible = folder.entries
    .filter(
      (item) =>
        (filter === '전체' || (filter === '폴더') === item.folder) &&
        item.name
          .normalize()
          .toLocaleLowerCase()
          .includes(query.trim().normalize().toLocaleLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(b.folder) - Number(a.folder) ||
        (descending ? -1 : 1) *
          a.name.localeCompare(b.name, 'ko', { numeric: true }),
    );
  return (
    <section
      className="workspace"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        if (writable && !busy) setDragging(true);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        upload(Array.from(e.dataTransfer.files));
      }}
      onDragLeave={(e) => {
        if (
          !(e.relatedTarget instanceof Node) ||
          !e.currentTarget.contains(e.relatedTarget)
        )
          setDragging(false);
      }}
    >
      <header className="topbar">
        <div className="search">
          <Search />
          <input
            type="search"
            aria-label="현재 폴더 검색"
            placeholder="현재 폴더에서 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="space-tools">
          <button onClick={() => setLookup('search')}>
            <Search />
            전체 공간 검색
          </button>
          {writable && (
            <button onClick={() => setLookup('trash')}>
              <Trash2 />
              휴지통
            </button>
          )}
        </div>
      </header>
      <div className="content">
        <nav className="crumbs" aria-label="폴더 경로">
          <HardDrive size={16} />
          {trail.map((part, i) => (
            <span key={part.id}>
              {i > 0 && <ChevronRight size={14} />}{' '}
              {i === trail.length - 1 ? (
                <span aria-current="page">{part.name}</span>
              ) : (
                <button disabled={busy} onClick={() => navigate(part.id)}>
                  {part.name}
                </button>
              )}
            </span>
          ))}
        </nav>
        <div className="cover">
          <div className="cover-art" aria-hidden="true">
            <div className="folio">
              <i className="folio-back" />
              <i className="leaf one" />
              <i className="leaf two" />
              <i className="leaf three" />
              <i className="folio-front">
                <Layers3 />
              </i>
            </div>
          </div>
          <div className="heading">
            <div>
              <h1>{current.name}</h1>
              <p>
                폴더 {folder.entries.filter((i) => i.folder).length}개{' '}
                <span>·</span> 파일{' '}
                {folder.entries.filter((i) => !i.folder).length}개
              </p>
            </div>
            {writable && (
              <div className="actions">
                <button
                  disabled={busy}
                  onClick={() => {
                    setName('');
                    setError('');
                    dialog.current?.showModal();
                  }}
                >
                  <FolderPlus />새 폴더
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => picker.current?.click()}
                >
                  <Upload />
                  파일 업로드
                </button>
                <input
                  hidden
                  ref={picker}
                  type="file"
                  multiple
                  accept=".pdf,.docx,.txt,.md"
                  aria-label="업로드할 파일"
                  onChange={(e) => {
                    upload(Array.from(e.target.files ?? []));
                    e.target.value = '';
                  }}
                />
              </div>
            )}
          </div>
        </div>
        <div className="tools">
          <div className="filters" aria-label="항목 종류">
            {['전체', '폴더', '파일'].map((f) => (
              <button
                key={f}
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="display">
            <button
              className="sort"
              aria-label={
                descending ? '이름 오름차순으로 정렬' : '이름 내림차순으로 정렬'
              }
              onClick={() => setDescending(!descending)}
            >
              {descending ? <ArrowUpZA /> : <ArrowDownAZ />}이름순
            </button>
            <div className="switch">
              <button
                aria-label="목록 보기"
                aria-pressed={!grid}
                onClick={() => chooseView(false)}
              >
                <List />
              </button>
              <button
                aria-label="격자 보기"
                aria-pressed={grid}
                onClick={() => chooseView(true)}
              >
                <LayoutGrid />
              </button>
            </div>
          </div>
        </div>
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {visible.length > 0 ? (
          <>
            <div className={'list-head' + (grid ? ' hide' : '')}>
              <span>이름</span>
              <span>유형</span>
              <span />
            </div>
            <ul className={grid ? 'items grid' : 'items'}>
              {visible.map((item) => {
                const type = fileType(item);
                const inside = (
                  <>
                    <span
                      className={
                        'file-icon ' +
                        (item.folder
                          ? 'folder'
                          : type === 'PDF'
                            ? 'pdf'
                            : 'doc')
                      }
                    >
                      {item.folder ? <FolderIcon /> : <FileText />}
                      {grid && (
                        <span className="cover-glyph" aria-hidden="true">
                          {item.folder ? (
                            <FolderIcon />
                          ) : (
                            <span className="sheet">
                              <b>{type}</b>
                              <i />
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                    <span className="filename">{item.name}</span>
                    <span className="kind">{type}</span>
                    <span className="row-action">
                      {item.folder ? <ChevronRight /> : <Eye />}
                    </span>
                  </>
                );
                return (
                  <li
                    key={item.id}
                    className={writable ? 'manageable' : undefined}
                  >
                    {item.folder ? (
                      <button disabled={busy} onClick={() => navigate(item.id)}>
                        {inside}
                      </button>
                    ) : (
                      <button
                        aria-label={item.name + ' 미리보기'}
                        onClick={() => setPreview(item)}
                      >
                        {inside}
                      </button>
                    )}
                    {writable && (
                      <span className="item-menu">
                        <button
                          className="icon"
                          aria-label={item.name + ' 관리'}
                          title="항목 관리"
                          onClick={() => setManaged(item)}
                        >
                          <Ellipsis />
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
              {grid && writable && !query && filter === '전체' && (
                <li className="upload-tile">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => picker.current?.click()}
                  >
                    <span>
                      <Upload />
                    </span>
                    <strong>파일 추가</strong>
                    <small>클릭하거나 파일을 끌어 놓으세요</small>
                  </button>
                </li>
              )}
            </ul>
          </>
        ) : (
          <div className="empty">
            <span className="empty-icon">
              {query ? <Search /> : <FolderIcon />}
            </span>
            <h2>
              {query
                ? '검색 결과가 없습니다'
                : filter === '전체'
                  ? '폴더가 비어 있습니다'
                  : filter + ' 항목이 없습니다'}
            </h2>
            {query ? (
              <button onClick={() => setQuery('')}>검색어 지우기</button>
            ) : filter !== '전체' ? (
              <button onClick={() => setFilter('전체')}>전체 보기</button>
            ) : (
              writable && <p>파일을 여기에 끌어 놓거나 업로드하세요.</p>
            )}
          </div>
        )}
      </div>
      {lookup && (
        <SpaceLookup
          mode={lookup}
          writable={writable}
          close={() => setLookup(null)}
          refreshKey={revision}
          manage={setManaged}
          preview={setPreview}
        />
      )}
      {managed && (
        <EntryTools
          item={managed}
          restore={lookup === 'trash'}
          close={() => setManaged(null)}
          changed={() => {
            setManaged(null);
            setRevision((n) => n + 1);
            void perform(async () => {
              try {
                setFolder(await read(current.id));
              } catch (e) {
                if ((e as { status?: number }).status !== 404) throw e;
                const root = await read(initial.current.id);
                setFolder(root);
                setTrail([root.current]);
              }
            });
          }}
        />
      )}
      {preview && (
        <FilePreview
          key={preview.id}
          file={preview}
          writable={writable}
          close={() => setPreview(null)}
        />
      )}
      {dragging && (
        <div className="drop">
          <Upload />
          <strong>이 폴더에 파일 업로드</strong>
        </div>
      )}
      {writable && (
        <dialog ref={dialog} aria-labelledby="folder-title">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              void perform(async () => {
                await post('folders', {
                  parent: current.id,
                  name: name.trim(),
                });
                dialog.current?.close();
                setFolder(await read(current.id));
                setFilter('전체');
                setQuery('');
                setNotice('폴더를 만들었습니다.');
              });
            }}
          >
            <header>
              <h2 id="folder-title">새 폴더</h2>
              <button
                type="button"
                className="icon"
                aria-label="닫기"
                onClick={() => dialog.current?.close()}
              >
                <X />
              </button>
            </header>
            <label>
              폴더 이름
              <input
                autoFocus
                required
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <footer>
              <button type="button" onClick={() => dialog.current?.close()}>
                취소
              </button>
              <button className="primary" disabled={busy || !name.trim()}>
                만들기
              </button>
            </footer>
          </form>
        </dialog>
      )}
    </section>
  );
}
