import { BlobReader, ZipReader } from '@zip.js/zip.js';

export async function docxText(blob: Blob, signal: AbortSignal) {
  const archive = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
  const limit = 8 * 1024 * 1024;
  try {
    let entries = 0;
    for await (const entry of archive.getEntriesGenerator()) {
      signal.throwIfAborted();
      if (++entries > 4096)
        throw new Error('문서 구성이 너무 커서 미리 볼 수 없습니다.');
      if (entry.directory || entry.filename !== 'word/document.xml') continue;
      const tooLarge = () =>
        new Error('문서 본문이 너무 커서 미리 볼 수 없습니다.');
      if (entry.uncompressedSize > limit) throw tooLarge();
      let size = 0;
      const chunks: string[] = [];
      const decoder = new TextDecoder();
      await entry.getData(
        new WritableStream<Uint8Array>({
          write(chunk) {
            size += chunk.byteLength;
            if (size > limit) throw tooLarge();
            chunks.push(decoder.decode(chunk, { stream: true }));
          },
        }),
        { signal, checkSignature: true },
      );
      chunks.push(decoder.decode());
      const xml = chunks.join('');
      if (/<!DOCTYPE/i.test(xml))
        throw new Error('지원하지 않는 문서 구성입니다.');
      const document = new DOMParser().parseFromString(xml, 'application/xml');
      if (document.getElementsByTagName('parsererror').length)
        throw new Error('문서 본문을 읽을 수 없습니다.');
      const ns = document.documentElement.namespaceURI;
      const lines = Array.from(document.getElementsByTagNameNS(ns, 'p'), (p) =>
        Array.from(p.getElementsByTagNameNS(ns, '*'), (node) =>
          node.localName === 't'
            ? node.textContent
            : node.localName === 'tab'
              ? '\t'
              : node.localName === 'br'
                ? '\n'
                : '',
        ).join(''),
      );
      return lines.join('\n');
    }
    throw new Error('DOCX 본문을 찾을 수 없습니다.');
  } finally {
    await archive.close();
  }
}
