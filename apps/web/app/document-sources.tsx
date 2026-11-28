import { useEffect, useState } from 'react';
import { api, post } from './drive-api';

export type Section = {
  unit: 'page' | 'paragraph' | 'line' | 'chapter';
  start: number;
  end: number;
  text: string;
  chapterTitle?: string;
};
type TextPage = {
  status: 'processing' | 'failed' | 'empty' | 'ready';
  reason: string | null;
  segments: Section[];
  total: number;
  offset: number;
  nextOffset: number | null;
};
export function sourceLocation(s: Section) {
  const n = s.start === s.end ? String(s.start) : s.start + '–' + s.end;
  if (s.unit === 'chapter') return n + '장 · ' + s.chapterTitle;
  return n + { page: '페이지', paragraph: '문단', line: '줄' }[s.unit];
}
export function DocumentSources({
  fileId,
  writable,
  openPage,
  initialOffset = 0,
}: {
  fileId: string;
  writable: boolean;
  initialOffset?: number;
  openPage: (n: number) => void;
}) {
  const [offset, setOffset] = useState(initialOffset),
    [result, setResult] = useState<TextPage | null>(null),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const path = `files/${encodeURIComponent(fileId)}/text`;
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setResult(null);
    setError('');
    async function read() {
      try {
        const data: TextPage = await api(path + '?offset=' + offset, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setResult(data);
        if (data.status === 'processing') timer = setTimeout(read, 1500);
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      }
    }
    void read();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [offset, revision, path]);
  async function retry() {
    try {
      await post(path + '/retry', {});
      setRevision((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (error) return <p role="alert">{error}</p>;
  if (!result || result.status === 'processing')
    return (
      <p role="status">
        {result ? '본문을 추출하고 있습니다.' : '추출 결과를 불러오는 중…'}
      </p>
    );
  if (result.status === 'empty')
    return (
      <p>추출할 텍스트가 없습니다. 이미지 속 글자는 원본에서 확인하세요.</p>
    );
  if (result.status === 'failed')
    return (
      <div>
        <p role="alert">{result.reason ?? '본문 추출에 실패했습니다.'}</p>
        {writable && (
          <button onClick={() => void retry()}>추출 다시 시도</button>
        )}
      </div>
    );
  return (
    <section className="source-sections" aria-label="출처별 본문">
      {result.segments.map((s, i) => (
        <article key={offset + i}>
          {s.unit === 'page' ? (
            <button
              onClick={() => openPage(s.start)}
              aria-label={sourceLocation(s) + ' 원본 보기'}
            >
              {sourceLocation(s)} ↗
            </button>
          ) : (
            <strong>{sourceLocation(s)}</strong>
          )}
          <pre>{s.text}</pre>
        </article>
      ))}
      {result.total > 10 && (
        <footer>
          <button
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - 10))}
          >
            이전 구간
          </button>
          <span>
            {offset + 1}–{offset + result.segments.length} / {result.total}
          </span>
          <button
            disabled={result.nextOffset === null}
            onClick={() => setOffset(result.nextOffset!)}
          >
            다음 구간
          </button>
        </footer>
      )}
    </section>
  );
}
