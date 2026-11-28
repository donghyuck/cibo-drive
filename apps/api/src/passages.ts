import type pg from 'pg';
import { transaction } from './drive-db.js';

export type Segment = {
  unit: 'page' | 'paragraph' | 'line' | 'chapter';
  start: number;
  end: number;
  text: string;
  chapterTitle?: string;
  href?: string;
};

// Never combine different source segments. Offsets are Unicode code points
// within the extracted segment, including preceding whitespace.
export function splitPassages(segments: Segment[]) {
  const passages = [];
  for (const [segment, source] of segments.entries()) {
    const chars = Array.from(source.text);
    let offset = 0;
    let line = source.start;
    while (offset < chars.length) {
      const limit = Math.min(offset + 800, chars.length);
      let stop = limit;
      if (limit < chars.length) {
        // Prefer the latest paragraph or line ending, then a word boundary.
        // Pack short paragraphs together without crossing a source segment.
        let paragraphBreak = offset;
        let lineBreak = offset;
        let wordBreak = offset;
        for (let i = offset; i < limit; i++) {
          if (chars[i] === '\n') {
            lineBreak = i + 1;
            if (source.unit === 'chapter' || chars[i - 1] === '\n')
              paragraphBreak = i + 1;
          }
          if (/\s/u.test(chars[i])) wordBreak = i + 1;
        }
        stop =
          [paragraphBreak, lineBreak, wordBreak].find(
            (end) => end - offset >= 400,
          ) ?? limit;
      }
      const part = chars.slice(offset, stop).join('');
      const breaks = part.match(/\n/g)?.length ?? 0;
      if (part.trim()) {
        const isLine = source.unit === 'line';
        passages.push({
          ...source,
          segment,
          offset,
          text: part,
          start: isLine ? line : source.start,
          end: isLine
            ? line + breaks - Number(part.endsWith('\n'))
            : source.end,
        });
      }
      offset = stop;
      line += breaks;
    }
  }
  return passages;
}

// Without an ID, claim one pre-migration file. Explicit rebuilds serialize
// with extraction and backfill on the same row and replace the entire result.
export async function rebuildPassages(db: pg.Pool, fileId?: string) {
  return transaction(db, async (client) => {
    const query =
      `SELECT artcl_idntfr,src_sctn_list FROM doc_artcl_txt
      WHERE prcs_stts_cd='ready' ` +
      (fileId
        ? 'AND artcl_idntfr=$1 FOR UPDATE'
        : 'AND srch_sctn_list IS NULL ORDER BY artcl_idntfr LIMIT 1 FOR UPDATE SKIP LOCKED');
    const {
      rows: [row],
    } = await client.query(query, fileId ? [fileId] : []);
    if (!row) return false;
    await client.query(
      'UPDATE doc_artcl_txt SET srch_sctn_list=$2::jsonb WHERE artcl_idntfr=$1',
      [row.artcl_idntfr, JSON.stringify(splitPassages(row.src_sctn_list))],
    );
    return true;
  });
}
