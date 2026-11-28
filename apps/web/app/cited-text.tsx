import { useEffect, useRef } from 'react';

export type Citation = { segment: number; offset: number; text: string };
export function CitedText({
  text,
  source,
  segment,
}: {
  text: string;
  source?: Citation;
  segment: number;
}) {
  const mark = useRef<HTMLElement>(null);
  useEffect(() => {
    mark.current?.scrollIntoView({ block: 'center' });
  }, [text, source, segment]);
  if (!source || source.segment !== segment || !source.text) return <>{text}</>;
  const chars = Array.from(text);
  const end = source.offset + Array.from(source.text).length;
  if (chars.slice(source.offset, end).join('') !== source.text)
    return <>{text}</>;
  return (
    <>
      {chars.slice(0, source.offset).join('')}
      <mark ref={mark}>{source.text}</mark>
      {chars.slice(end).join('')}
    </>
  );
}
