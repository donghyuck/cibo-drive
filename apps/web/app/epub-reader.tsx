import { BookOpen, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, post } from './drive-api';

type Chapter = {
  number: number;
  title: string;
  href: string;
  offset: number;
  count: number;
};
type Contents = {
  status: 'processing' | 'ready' | 'failed' | 'empty';
  reason: string | null;
  chapters: Chapter[];
};

export function EpubReader({
  fileId,
  writable,
}: {
  fileId: string;
  writable: boolean;
}) {
  const path = 'files/' + encodeURIComponent(fileId);
  const [book, setBook] = useState<Contents | null>(null),
    [index, setIndex] = useState(0),
    [page, setPage] = useState(0);
  const [text, setText] = useState<string | null>(null),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  const [fontSize, setFontSize] = useState(20);
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem('cibo.reader.fontSize'));
      if ([16, 18, 20, 22, 24, 26].includes(saved)) setFontSize(saved);
    } catch {
      // The reader also works when browser storage is unavailable.
    }
  }, []);
  function resize(size: number) {
    setFontSize(size);
    try {
      localStorage.setItem('cibo.reader.fontSize', String(size));
    } catch {
      // Keep the setting for this session.
    }
  }
  const chapter = book?.chapters[index];
  useEffect(() => {
    const c = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const b: Contents = await api(path + '/chapters', { signal: c.signal });
        if (c.signal.aborted) return;
        setBook(b);
        if (b.status === 'processing') timer = setTimeout(load, 1500);
      } catch (e) {
        if (!c.signal.aborted) setError((e as Error).message);
      }
    }
    setError('');
    void load();
    return () => {
      c.abort();
      clearTimeout(timer);
    };
  }, [path, attempt]);
  useEffect(() => {
    if (!chapter) return;
    const c = new AbortController();
    setText(null);
    setError('');
    api(path + '/text?offset=' + (chapter.offset + page * 10), {
      signal: c.signal,
    })
      .then((data) => {
        if (!c.signal.aborted)
          setText(
            data.segments
              .filter((s: { start: number }) => s.start === chapter.number)
              .map((s: { text: string }) => s.text)
              .join(''),
          );
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [chapter, page, path]);
  function go(i: number, p = 0) {
    setText(null);
    setIndex(i);
    setPage(p);
  }
  if (error) return <p role="alert">{error}</p>;
  if (!book || book.status === 'processing')
    return <p role="status">책의 목차와 본문을 준비하고 있습니다.</p>;
  if (book.status === 'failed')
    return (
      <div>
        <p role="alert">{book.reason}</p>
        {writable && (
          <button
            onClick={async () => {
              try {
                await post(path + '/text/retry', {});
                setBook(null);
                setAttempt((v) => v + 1);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            다시 추출
          </button>
        )}
      </div>
    );
  if (!chapter)
    return (
      <p>읽을 수 있는 텍스트가 없습니다. 원본을 전자책 리더에서 확인하세요.</p>
    );
  return (
    <section className="ebook">
      <div className="ebook-controls">
        <label>
          <BookOpen size={17} aria-hidden="true" /> 목차
          <select value={index} onChange={(e) => go(Number(e.target.value))}>
            {book.chapters.map((ch, i) => (
              <option key={ch.number} value={i}>
                {ch.number}장 · {ch.title}
              </option>
            ))}
          </select>
        </label>
        <div className="ebook-size" role="group" aria-label="본문 글자 크기">
          <button
            aria-label="글자 작게"
            disabled={fontSize <= 16}
            onClick={() => resize(fontSize - 2)}
          >
            가−
          </button>
          <button
            aria-label="글자 크게"
            disabled={fontSize >= 26}
            onClick={() => resize(fontSize + 2)}
          >
            가＋
          </button>
        </div>
      </div>
      <div
        className="ebook-scroll"
        key={index + '-' + page}
        tabIndex={0}
        role="region"
        aria-label="책 본문"
      >
        <article className="ebook-page" style={{ fontSize }}>
          <small>제 {chapter.number} 장</small>
          <h3>{chapter.title}</h3>
          {text === null ? (
            <p role="status">불러오는 중…</p>
          ) : (
            <div className="ebook-prose">{text}</div>
          )}
        </article>
      </div>
      <nav className="ebook-turn" aria-label="전자책 본문 이동">
        <button
          disabled={index === 0 && page === 0}
          onClick={() =>
            page
              ? go(index, page - 1)
              : go(
                  index - 1,
                  Math.floor((book.chapters[index - 1].count - 1) / 10),
                )
          }
        >
          <ChevronLeft size={16} aria-hidden="true" /> 이전
        </button>
        <span role="status">
          {index + 1} / {book.chapters.length}장
          {chapter.count > 10 &&
            ` · 구간 ${page + 1} / ${Math.ceil(chapter.count / 10)}`}
        </span>
        <button
          disabled={
            index === book.chapters.length - 1 &&
            (page + 1) * 10 >= chapter.count
          }
          onClick={() =>
            (page + 1) * 10 < chapter.count
              ? go(index, page + 1)
              : go(index + 1)
          }
        >
          다음 <ChevronRight size={16} aria-hidden="true" />
        </button>
      </nav>
    </section>
  );
}
