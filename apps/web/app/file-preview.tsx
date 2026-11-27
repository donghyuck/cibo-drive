import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Maximize2, Minimize2, X } from 'lucide-react';
import { DocumentSources } from './document-sources';
import dynamic from 'next/dynamic';

const Markdown = dynamic(() => import('react-markdown'));
type Preview =
  | { kind: 'epub' }
  | { kind: 'pdf' }
  | { kind: 'text' | 'markdown'; text: string; truncated: boolean }
  | { kind: 'error'; message: string };
const limit = 100_000;

export function FilePreview({
  file,
  writable,
  close,
}: {
  file: { id: string; name: string };
  writable: boolean;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [sources, setSources] = useState(false);
  const [pdfPage, setPdfPage] = useState<number | null>(null);
  const resizeLabel = expanded ? '기본 크기로 복원' : '전체 화면으로 확대';
  const src = '/api/files/' + encodeURIComponent(file.id);
  const url = src + '/preview';
  const ext = file.name.split('.').pop()?.toLowerCase();
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => {
      node.close();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function load() {
      if (ext === 'epub') {
        setPreview({ kind: 'epub' });
        return;
      }
      const pdf = ext === 'pdf';
      const response = await fetch(url, {
        method: pdf ? 'HEAD' : 'GET',
        signal,
        cache: 'no-store',
      });
      if (!response.ok)
        throw new Error(
          response.status === 403 || response.status === 401
            ? '파일을 볼 권한이 없습니다.'
            : response.status === 503
              ? '다른 미리보기를 닫고 잠시 후 다시 열어주세요.'
              : '미리보기를 불러올 수 없습니다.',
        );
      if (pdf) {
        if (!signal.aborted) setPreview({ kind: 'pdf' });
        return;
      }
      const text =
        ext === 'docx'
          ? await (
              await import('./docx-text')
            ).docxText(await response.blob(), signal)
          : await response.text();
      if (!signal.aborted)
        setPreview({
          kind: ext === 'md' ? 'markdown' : 'text',
          text: text.slice(0, limit),
          truncated: text.length > limit,
        });
    }
    void load().catch((error) => {
      if (!signal.aborted)
        setPreview({
          kind: 'error',
          message:
            error instanceof Error ? error.message : '파일을 읽을 수 없습니다.',
        });
    });
    return () => controller.abort();
  }, [ext, url]);
  return (
    <dialog
      className={expanded ? 'preview expanded' : 'preview'}
      ref={dialog}
      aria-labelledby="preview-title"
      onCancel={(e) => {
        e.preventDefault();
        if (expanded) setExpanded(false);
        else close();
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        )
          close();
      }}
    >
      <header>
        <div>
          <small>
            {ext?.toUpperCase()} ·{' '}
            {ext === 'docx' ? '본문 미리보기' : '미리보기'}
          </small>
          <h2 id="preview-title">{file.name}</h2>
        </div>
        <div className="preview-actions">
          <a href={src} download aria-label="원본 다운로드">
            <ArrowDownToLine size={17} />
            <span>다운로드</span>
          </a>
          <button
            className="icon"
            type="button"
            aria-label={resizeLabel}
            title={resizeLabel}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <Minimize2 /> : <Maximize2 />}
          </button>
          <button
            autoFocus
            className="icon"
            onClick={close}
            aria-label="미리보기 닫기"
          >
            <X />
          </button>
        </div>
      </header>
      {ext !== 'epub' && (
        <div className="preview-modes" aria-label="문서 보기 방식">
          <button aria-pressed={!sources} onClick={() => setSources(false)}>
            원본 보기
          </button>
          <button aria-pressed={sources} onClick={() => setSources(true)}>
            본문·출처
          </button>
        </div>
      )}
      <div className="preview-body" key={String(sources)}>
        {sources ? (
          <DocumentSources
            fileId={file.id}
            writable={writable}
            openPage={(n) => {
              setPdfPage(n);
              setSources(false);
            }}
          />
        ) : !preview ? (
          <p role="status">파일을 불러오는 중…</p>
        ) : preview.kind === 'error' ? (
          <p role="alert">{preview.message}</p>
        ) : preview.kind === 'epub' ? (
          <p>원본을 다운로드해 EPUB 리더에서 열어보세요.</p>
        ) : preview.kind === 'pdf' ? (
          <object
            type="application/pdf"
            data={pdfPage ? url + '#page=' + pdfPage : url}
            aria-label={file.name + ' PDF 미리보기'}
          >
            <p>
              이 브라우저에서는 PDF를 표시할 수 없습니다.{' '}
              <a href={src} download>
                원본 다운로드
              </a>
            </p>
          </object>
        ) : (
          <article className="preview-paper">
            {!preview.text.trim() ? (
              <p>표시할 본문이 없습니다.</p>
            ) : preview.kind === 'markdown' ? (
              <Markdown
                skipHtml
                components={{
                  img: ({ alt }) => <span>{alt}</span>,
                  a: ({ children }) => <span>{children}</span>,
                }}
              >
                {preview.text}
              </Markdown>
            ) : (
              <pre>{preview.text}</pre>
            )}
            {preview.truncated && (
              <p>
                처음 100,000자만 표시합니다. 전체 내용은 원본을 다운로드해
                확인하세요.
              </p>
            )}
          </article>
        )}
      </div>
    </dialog>
  );
}
