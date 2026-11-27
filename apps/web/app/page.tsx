'use client';

import { Layers3 } from 'lucide-react';
import { Sidebar } from './sidebar';
import { FileBrowser, type Folder } from './file-browser';
import { api, post } from './drive-api';
import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';

type Role = 'admin' | 'editor' | 'viewer';
type Status = 'pending' | 'active' | 'suspended';
type Account = {
  id: string;
  email: string;
  role: Role;
  status: Status;
  space_id: number | null;
  master?: boolean;
};
type Google = {
  accounts: {
    id: {
      initialize(options: {
        client_id: string;
        callback: (result: { credential: string }) => void;
      }): void;
      renderButton(element: HTMLElement, options: object): void;
    };
  };
};
declare global {
  interface Window {
    google?: Google;
  }
}

function AccountForm({
  account,
  save,
}: {
  account: Account;
  save: (a: Account) => Promise<void>;
}) {
  const [a, set] = useState(account);
  useEffect(() => set(account), [account]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save(a);
      }}
    >
      <strong>{a.email}</strong>
      <label>
        상태{' '}
        <select
          disabled={a.master}
          value={a.status}
          onChange={(e) => set({ ...a, status: e.target.value as Status })}
        >
          <option value="pending">승인 대기</option>
          <option value="active">활성</option>
          <option value="suspended">정지</option>
        </select>
      </label>
      <label>
        역할{' '}
        <select
          disabled={a.master}
          value={a.role}
          onChange={(e) => set({ ...a, role: e.target.value as Role })}
        >
          <option value="viewer">조회</option>
          <option value="editor">편집</option>
          <option value="admin">관리자</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={!!a.space_id}
          onChange={(e) => set({ ...a, space_id: e.target.checked ? 1 : null })}
        />{' '}
        공간 접근
      </label>
      <button>저장</button>
    </form>
  );
}
export default function Drive() {
  const [user, setUser] = useState<Account | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [folder, setFolder] = useState<Folder | null>(null);
  const [clientId, setClientId] = useState('');
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const [view, setView] = useState<'files' | 'accounts'>('files');
  const [homeKey, setHomeKey] = useState(0);
  const login = useRef<HTMLDivElement>(null);
  async function refresh() {
    const me: Account = await api('me');
    setUser(me);
    setFolder(
      me.status === 'active' && me.space_id ? await api('folder') : null,
    );
    setAccounts(
      me.status === 'active' && me.role === 'admin'
        ? await api('admin/accounts')
        : [],
    );
  }
  async function act(fn: () => Promise<void>) {
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  useEffect(() => {
    void act(async () => {
      const config = await api('config');
      setClientId(config.clientId);
      if (!config.clientId) setMessage('Google 로그인 설정이 필요합니다.');
      try {
        await refresh();
      } catch (e) {
        if ((e as { status: number }).status !== 401) throw e;
      }
    });
  }, []);
  useEffect(() => {
    if (user || !clientId || !ready || !login.current || !window.google) return;
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: ({ credential }) =>
        void act(async () => {
          await post('login', { credential });
          await refresh();
        }),
    });
    window.google.accounts.id.renderButton(login.current, {
      theme: 'outline',
      size: 'large',
    });
  }, [clientId, ready, user]);
  return (
    <div className="shell">
      <Sidebar
        user={user}
        view={view}
        canManage={accounts.length > 0}
        onFiles={() =>
          void act(async () => {
            await refresh();
            setHomeKey((k) => k + 1);
            setView('files');
          })
        }
        onManage={() => {
          setView('accounts');
          void act(refresh);
        }}
        onLogout={() =>
          void act(async () => {
            await post('logout', {});
            setUser(null);
            setFolder(null);
            setAccounts([]);
            setView('files');
          })
        }
      />
      <main>
        {message && <p role="alert">{message}</p>}
        {!user && (
          <section className="welcome">
            <span className="brand-mark">
              <Layers3 />
            </span>
            <h1>팀 문서 공간</h1>
            <p>Google 계정으로 로그인하세요.</p>
            <Script
              src="https://accounts.google.com/gsi/client"
              onReady={() => setReady(true)}
              onError={() =>
                setMessage('Google 로그인 화면을 불러올 수 없습니다.')
              }
            />
            <div ref={login} />
          </section>
        )}
        {user && view === 'accounts' && accounts.length > 0 ? (
          <section className="admin">
            <h1>계정 관리</h1>
            {accounts.map((a) => (
              <AccountForm
                key={a.id}
                account={a}
                save={(next) =>
                  act(async () => {
                    await post('admin/accounts/' + next.id, {
                      status: next.status,
                      role: next.role,
                      access: !!next.space_id,
                    });
                    await refresh();
                  })
                }
              />
            ))}
          </section>
        ) : (
          user &&
          (folder ? (
            <FileBrowser
              key={homeKey}
              initial={folder}
              writable={user.role !== 'viewer'}
            />
          ) : (
            <section className="welcome">
              <h1>팀 문서 공간</h1>
              <p>
                {user.status === 'pending'
                  ? '관리자 승인을 기다리고 있습니다.'
                  : user.status === 'suspended'
                    ? '정지된 계정입니다.'
                    : '문서 공간 접근 권한이 필요합니다.'}
              </p>
              <button onClick={() => void act(refresh)}>새로고침</button>
            </section>
          ))
        )}
      </main>
    </div>
  );
}
