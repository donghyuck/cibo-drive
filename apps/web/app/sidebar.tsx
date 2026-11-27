import { useEffect, useRef, useState } from 'react';
import {
  Files,
  Layers3,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  UsersRound,
  X,
} from 'lucide-react';

type SidebarProps = {
  user: { email: string; role: 'admin' | 'editor' | 'viewer' } | null;
  view: 'files' | 'accounts';
  canManage: boolean;
  onFiles: () => void;
  onManage: () => void;
  onLogout: () => void;
};
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Layers3 />
      </span>
      <span>Cibo Drive</span>
    </div>
  );
}
export function Sidebar({
  user,
  view,
  canManage,
  onFiles,
  onManage,
  onLogout,
}: SidebarProps) {
  const [compact, setCompact] = useState(false);
  const [open, setOpen] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    try {
      setCompact(localStorage.getItem('cibo-sidebar') === 'compact');
    } catch {}
    const mobile = window.matchMedia('(max-width: 760px)');
    function resize() {
      if (!mobile.matches) drawer.current?.close();
    }
    mobile.addEventListener('change', resize);
    return () => mobile.removeEventListener('change', resize);
  }, []);
  function toggle() {
    setCompact(!compact);
    try {
      localStorage.setItem('cibo-sidebar', compact ? 'expanded' : 'compact');
    } catch {}
  }
  function select(action: () => void) {
    drawer.current?.close();
    action();
  }
  const label = compact ? '사이드바 펼치기' : '사이드바 접기';
  const navigation = user && (
    <nav aria-label="워크스페이스">
      <button
        title="팀 문서 공간"
        aria-label="팀 문서 공간"
        aria-current={view === 'files' ? 'page' : undefined}
        onClick={() => select(onFiles)}
      >
        <Files />
        <span>팀 문서 공간</span>
      </button>
      {canManage && (
        <button
          title="계정 관리"
          aria-label="계정 관리"
          aria-current={view === 'accounts' ? 'page' : undefined}
          onClick={() => select(onManage)}
        >
          <UsersRound />
          <span>계정 관리</span>
        </button>
      )}
    </nav>
  );
  const profile = user && (
    <div className="profile">
      <span className="avatar" title={user.email} aria-hidden="true">
        {user.email.slice(0, 1).toUpperCase()}
      </span>
      <div className="identity">
        <strong title={user.email}>{user.email}</strong>
        <small>
          {{ admin: '관리자', editor: '편집자', viewer: '조회자' }[user.role]}
        </small>
      </div>
      <button
        className="icon"
        aria-label="로그아웃"
        title="로그아웃"
        onClick={() => select(onLogout)}
      >
        <LogOut />
      </button>
    </div>
  );
  return (
    <>
      <aside
        id="desktop-sidebar"
        className={'rail desktop-rail' + (compact ? ' compact' : '')}
      >
        <div className="rail-head">
          <Brand />
          <button
            className="rail-toggle"
            aria-label={label}
            title={label}
            aria-expanded={!compact}
            aria-controls="desktop-sidebar"
            onClick={toggle}
          >
            {compact ? <PanelLeftOpen /> : <PanelLeftClose />}
          </button>
        </div>
        {navigation}
        {profile}
      </aside>
      <header className="mobile-bar">
        <button
          className="rail-toggle"
          aria-label="메뉴 열기"
          aria-controls="mobile-sidebar"
          aria-expanded={open}
          onClick={() => {
            drawer.current?.showModal();
            setOpen(true);
          }}
        >
          <Menu />
        </button>
        <Brand />
      </header>
      <dialog
        id="mobile-sidebar"
        className="drawer rail"
        ref={drawer}
        aria-label="사이드바"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target !== e.currentTarget) return;
          const rect = e.currentTarget.getBoundingClientRect();
          if (e.clientX >= rect.right || e.clientX < rect.left)
            drawer.current?.close();
        }}
      >
        <div className="rail-head">
          <Brand />
          <button
            className="rail-toggle"
            autoFocus
            aria-label="메뉴 닫기"
            onClick={() => drawer.current?.close()}
          >
            <X />
          </button>
        </div>
        {navigation}
        {profile}
      </dialog>
    </>
  );
}
