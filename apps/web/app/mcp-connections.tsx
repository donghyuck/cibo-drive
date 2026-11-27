import { useEffect, useState } from 'react';
import { api, post } from './drive-api';

type Connection = { id: string; name: string; expires_at: string };
export function McpConnections({ canIssue }: { canIssue: boolean }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [name, setName] = useState(''),
    [secret, setSecret] = useState(''),
    [secretId, setSecretId] = useState('');
  const [endpoint, setEndpoint] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  async function refresh() {
    setConnections(await api('mcp-tokens'));
  }
  useEffect(() => {
    setEndpoint(location.origin + '/api/mcp');
    void refresh().catch((e) => setMessage(e.message));
  }, []);
  async function action(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await work();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin mcp-connections">
      <h1>MCP 연결</h1>
      <p>
        Streamable HTTP 클라이언트에 아래 주소와 Bearer 토큰을 설정하세요.
        연결된 클라이언트는 내 권한으로 파일을 찾고 읽을 수 있습니다.
      </p>
      <label>
        서버 주소
        <input readOnly value={endpoint} />
      </label>
      {canIssue && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              const result = await post('mcp-tokens', { name: name.trim() });
              setSecret(result.token);
              setSecretId(result.id);
              setName('');
              await refresh();
            });
          }}
        >
          <label>
            연결 이름
            <input
              maxLength={64}
              required
              value={name}
              placeholder="예: MCP Inspector"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button className="primary" disabled={busy || !name.trim()}>
            읽기 전용 토큰 발급
          </button>
        </form>
      )}
      {secret && (
        <div>
          <label>
            발급된 토큰 · 이 화면에서 한 번만 확인할 수 있습니다
            <input type="password" readOnly value={secret} autoComplete="off" />
          </label>
          <button
            onClick={() =>
              void action(async () => {
                await navigator.clipboard.writeText(secret);
                setMessage('토큰을 복사했습니다.');
              })
            }
          >
            토큰 복사
          </button>
          <button onClick={() => setSecret('')}>토큰 숨기기</button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      <h2>내 연결</h2>
      {connections.length === 0 ? (
        <p>발급된 연결이 없습니다.</p>
      ) : (
        connections.map((c) => (
          <div className="mcp-row" key={c.id}>
            <div>
              <strong>{c.name}</strong>
              <small>
                {new Date(c.expires_at).toLocaleDateString('ko-KR')} 만료
              </small>
            </div>
            <button
              disabled={busy}
              aria-label={c.name + ' 연결 해제'}
              onClick={() =>
                void action(async () => {
                  await api('mcp-tokens/' + c.id, { method: 'DELETE' });
                  if (c.id === secretId) setSecret('');
                  await refresh();
                  setMessage('연결이 해제됐습니다.');
                })
              }
            >
              연결 해제
            </button>
          </div>
        ))
      )}
    </section>
  );
}
