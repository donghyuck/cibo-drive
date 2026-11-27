import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './style.css';

export const metadata: Metadata = {
  title: 'Cibo Drive',
  description: '사람과 AI 에이전트가 함께 쓰는 팀 파일 저장소',
};

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="ko"><body>{children}</body></html>;
}
