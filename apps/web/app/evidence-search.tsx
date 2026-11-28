import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, Search, X } from 'lucide-react';
import { api } from './drive-api';
import { sourceLocation, type Section } from './document-sources';

export type EvidenceHit = Section & {
  fileId: string;
  name: string;
  path: string[];
  segment: number;
  offset: number;
};

export function EvidenceSearch({
  close,
  open,
}: {
  close: () => void;
  open: (hit: EvidenceHit) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const [question, setQuestion] = useState('');
  const [results, setResults] = useState<EvidenceHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => {
      request.current?.abort();
      node.close();
    };
  }, []);
  async function search(event: FormEvent) {
    event.preventDefault();
    if (!question.trim() || busy) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setResults(null);
    setError('');
    try {
      const data = await api('search/passages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim() }),
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setResults(data.results);
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="lookup evidence"
      aria-labelledby="evidence-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header>
        <h2 id="evidence-title">질문으로 검색</h2>
        <button className="icon" aria-label="검색 닫기" onClick={close}>
          <X />
        </button>
      </header>
      <form onSubmit={search}>
        <label htmlFor="drive-question">내 문서에 질문하기</label>
        <div className="evidence-input">
          <input
            id="drive-question"
            autoFocus
            maxLength={2000}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="문서에서 무엇을 찾고 싶으세요?"
          />
          <button className="primary" disabled={busy || !question.trim()}>
            <Search size={16} />
            검색
          </button>
        </div>
      </form>
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">관련 문단을 찾고 있습니다…</p>}
      {results && (
        <>
          <p role="status">
            {results.length
              ? '관련 문단 ' + results.length + '개'
              : '검색할 수 있는 문단이 없습니다.'}
          </p>
          <ul>
            {results.map((hit) => (
              <li key={[hit.fileId, hit.segment, hit.offset].join(':')}>
                <button className="evidence-hit" onClick={() => open(hit)}>
                  <strong>{hit.name}</strong>
                  <small>
                    {[...hit.path.slice(0, -1), sourceLocation(hit)].join(
                      ' / ',
                    )}{' '}
                    <ArrowUpRight size={14} />
                  </small>
                  <span>{hit.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </dialog>
  );
}
