import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitPassages, type Segment } from './passages.js';

test('preserves page, paragraph, line ranges and EPUB anchor across Unicode splits', () => {
  const segments: Segment[] = [
    {
      unit: 'page',
      start: 5,
      end: 5,
      text: '가'.repeat(600) + '\n\n' + '나'.repeat(700),
    },
    { unit: 'paragraph', start: 12, end: 12, text: '문서 문단' },
    {
      unit: 'line',
      start: 9,
      end: 11,
      text: '첫 줄\n' + '나'.repeat(1000) + '\n끝 줄',
    },
    {
      unit: 'chapter',
      start: 3,
      end: 3,
      chapterTitle: '차례',
      href: 'c.xhtml#x',
      text: '😀'.repeat(801),
    },
  ];
  const result = splitPassages(segments);
  assert.deepEqual(result, splitPassages(segments));
  for (const [index, source] of segments.entries()) {
    const pieces = result.filter((p) => p.segment === index);
    assert.equal(pieces.map((p) => p.text).join(''), source.text);
    for (const p of pieces) {
      const size = Array.from(p.text).length;
      assert.ok(size <= 800);
      assert.equal(
        Array.from(source.text)
          .slice(p.offset, p.offset + size)
          .join(''),
        p.text,
      );
      if (source.unit !== 'line')
        assert.deepEqual(
          { ...p, text: source.text, offset: 0 },
          { ...source, segment: index, offset: 0 },
        );
    }
  }
  assert.equal(result[0].text.length, 602);
  assert.deepEqual(
    result.filter((p) => p.unit === 'line').map((p) => [p.start, p.end]),
    [
      [9, 10],
      [10, 11],
    ],
  );
  assert.deepEqual(splitPassages([]), []);
});
