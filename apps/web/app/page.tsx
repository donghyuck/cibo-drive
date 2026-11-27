'use client';

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
type Folder = {
  current: { id: string; name: string; parent_id: string | null };
  entries: { id: string; name: string; folder: boolean }[];
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

async function api(path: string, init?: RequestInit) {
  const res = await fetch('/api/' + path, { cache: 'no-store', ...init });
  if (!res.ok)
    throw Object.assign(
      new Error(
        (await res.json().catch(() => ({}))).error ?? '요청에 실패했습니다.',
      ),
      { status: res.status },
    );
  return res.status === 204 ? null : res.json();
}
function post(path: string, body: object) {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
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
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
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
  async function open(id: string) {
    setFolder(await api('folder?id=' + id));
  }
  return (
    <main className="shell">
      <aside>
        <strong>Cibo Drive</strong>
        <p>팀 파일 저장소</p>
        {user && (
          <>
            <p>{user.email}</p>
            <button
              onClick={() =>
                void act(async () => {
                  await post('logout', {});
                  setUser(null);
                  setFolder(null);
                  setAccounts([]);
                  setFile(null);
                  setName('');
                })
              }
            >
              로그아웃
            </button>
          </>
        )}
      </aside>
      <section>
        <h1>{folder?.current.name ?? '팀 문서 공간'}</h1>
        {message && <p role="alert">{message}</p>}
        {!user && (
          <>
            <Script
              src="https://accounts.google.com/gsi/client"
              onReady={() => setReady(true)}
              onError={() =>
                setMessage('Google 로그인 화면을 불러올 수 없습니다.')
              }
            />
            <div ref={login} />
          </>
        )}
        {user && !folder && (
          <p>
            {user.status === 'pending'
              ? '관리자 승인을 기다리고 있습니다.'
              : user.status === 'suspended'
                ? '정지된 계정입니다.'
                : '문서 공간 접근 권한이 필요합니다.'}{' '}
            <button onClick={() => void act(refresh)}>새로고침</button>
          </p>
        )}
        {folder && (
          <>
            {folder.current.parent_id && (
              <button
                onClick={() => void act(() => open(folder.current.parent_id!))}
              >
                상위 폴더
              </button>
            )}
            {user?.role !== 'viewer' && (
              <>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(async () => {
                      await post('folders', {
                        parent: folder.current.id,
                        name,
                      });
                      setName('');
                      await open(folder.current.id);
                    });
                  }}
                >
                  <input
                    required
                    aria-label="새 폴더 이름"
                    placeholder="새 폴더 이름"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <button>폴더 만들기</button>
                </form>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    void act(async () => {
                      if (!file) return;
                      await api(
                        'files?' +
                          new URLSearchParams({
                            parent: folder.current.id,
                            name: file.name,
                          }),
                        {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/octet-stream',
                          },
                          body: file,
                        },
                      );
                      form.reset();
                      setFile(null);
                      await open(folder.current.id);
                    });
                  }}
                >
                  <input
                    aria-label="업로드할 파일"
                    required
                    type="file"
                    accept=".pdf,.docx,.txt,.md"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  <button>업로드</button>
                </form>
              </>
            )}
            {folder.entries.length ? (
              <ul>
                {folder.entries.map((item) => (
                  <li key={item.id}>
                    {item.folder ? (
                      <button onClick={() => void act(() => open(item.id))}>
                        {item.name}
                      </button>
                    ) : (
                      <a href={'/api/files/' + item.id} download>
                        {item.name}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p>폴더가 비어 있습니다.</p>
            )}
          </>
        )}
        {accounts.length > 0 && (
          <>
            <h2>계정 관리</h2>
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
          </>
        )}
      </section>
    </main>
  );
}
