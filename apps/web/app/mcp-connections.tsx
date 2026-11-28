import { useEffect, useState } from 'react';
import { api, post } from './drive-api';

type Connection = {
  id: string;
  name: string;
  expires_at: string;
  oauth?: boolean;
};
export function McpConnections({ canIssue }: { canIssue: boolean }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [name, setName] = useState(''),
    [secret, setSecret] = useState(''),
    [secretId, setSecretId] = useState('');
  const [endpoint, setEndpoint] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const command = `codex mcp add cibo-drive --url '${endpoint}' --bearer-token-env-var CIBO_MCP_TOKEN`;
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
        MCP를 지원하는 앱에서 내 문서 공간을 검색하고 파일 본문과 출처를 읽을 수
        있습니다.
      </p>
      <details open>
        <summary>Codex에서 브라우저로 연결하기</summary>
        <pre>
          {endpoint &&
            `codex mcp add cibo-drive-oauth --url '${endpoint}' --oauth-client-id cibo-codex`}
        </pre>
        <p>
          Codex가 연 브라우저에서 로그인하고 읽기 권한을 승인하세요. 연결은
          사용할 때 자동 갱신되며, 90일 동안 갱신하지 않으면 다시 로그인해야
          합니다.
        </p>
      </details>
      <ol className="mcp-steps">
        <li>
          <h2>연결 이름을 정하고 토큰을 발급하세요</h2>
          <p>
            토큰은 앱에 읽기 권한을 주는 연결용 비밀번호입니다. 앱마다 구분하기
            쉬운 이름을 쓰세요. 토큰은 30일간 유효합니다.
          </p>
          {!canIssue && (
            <p>
              발급하려면 활성 계정과 문서 공간 접근 권한이 필요합니다.
              관리자에게 권한을 요청하세요.
            </p>
          )}
          {canIssue && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(async () => {
                  const result = await post('mcp-tokens', {
                    name: name.trim(),
                  });
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
                발급된 토큰 · 지금 복사하세요
                <input
                  type="password"
                  readOnly
                  value={secret}
                  autoComplete="off"
                />
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
              <p>
                이 화면을 닫으면 토큰을 다시 복사할 수 없습니다. 분실하면
                아래에서 연결을 해제하고 새 토큰을 발급하세요.
              </p>
            </div>
          )}
        </li>
        <li>
          <h2>사용할 앱에서 MCP 서버를 추가하세요</h2>
          <p>
            앱의 MCP 설정에서 연결 방식은 <strong>Streamable HTTP</strong>를
            선택하고 아래 서버 주소를 붙여 넣으세요.
          </p>
          <details>
            <summary>Codex에 연결하기</summary>
            <p>
              Mac 터미널(zsh)에서 아래 첫 줄을 실행하고 발급된 토큰을 붙여
              넣으세요. 입력은 화면에 표시되지 않습니다.
            </p>
            <pre>
              read -rs 'CIBO_MCP_TOKEN?Cibo 토큰: ' &amp;&amp; export
              CIBO_MCP_TOKEN
            </pre>
            <pre>{command}</pre>
            <button
              disabled={!endpoint}
              onClick={() =>
                void action(async () => {
                  await navigator.clipboard.writeText(command);
                  setMessage('Codex 등록 명령을 복사했습니다.');
                })
              }
            >
              Codex 등록 명령 복사
            </button>
            <p>
              <code>codex mcp get cibo-drive</code>로 등록을 확인하고, 같은
              터미널에서 <code>codex</code>를 실행하세요. 데스크톱 앱은 앱 실행
              환경에도 CIBO_MCP_TOKEN이 필요합니다.
            </p>
            <p>
              Codex에 “cibo-drive의 connection_status를 실행해줘”라고
              요청하세요. 인증과 현재 공간의 색인 완료 파일 수를 확인한 뒤 질문
              검색을 시험할 수 있습니다.
            </p>
            <p>
              연결 거부 시 서버 주소와 실행 상태를 확인하세요. 401이면 토큰
              만료·해제 또는 실행 환경을, 403이면 계정 상태와 공간 권한을
              확인하세요.
            </p>
          </details>
          <div className="mcp-endpoint">
            <label>
              서버 주소
              <input readOnly value={endpoint} />
            </label>
            <button
              disabled={!endpoint || busy}
              onClick={() =>
                void action(async () => {
                  await navigator.clipboard.writeText(endpoint);
                  setMessage('서버 주소를 복사했습니다.');
                })
              }
            >
              주소 복사
            </button>
          </div>
          <p>
            인증 방식은 <strong>Bearer Token</strong>을 선택하고 복사한 토큰
            값만 입력하세요.
          </p>
          <details>
            <summary>앱에 HTTP 헤더 입력란만 있나요?</summary>
            <p>
              헤더 이름에 <code>Authorization</code>, 값에 <code>Bearer</code>와
              공백 한 칸, 발급받은 토큰을 차례로 입력하세요.
            </p>
          </details>
        </li>
        <li>
          <h2>폴더 목록으로 연결을 확인하세요</h2>
          <p>
            앱에서 연결한 뒤 <code>list_folder</code>를 인자 없이 실행하세요. 팀
            문서 공간의 폴더와 파일 목록이 표시되면 연결된 것입니다.
          </p>
        </li>
      </ol>
      {message && <p role="status">{message}</p>}
      <h2>내 연결</h2>
      <p>
        사용을 마친 앱은 연결을 해제하세요. 해당 토큰은 즉시 사용할 수 없게
        됩니다.
      </p>
      {connections.length === 0 ? (
        <p>발급된 연결이 없습니다.</p>
      ) : (
        connections.map((c) => (
          <div className="mcp-row" key={c.id}>
            <div>
              <strong>{c.name}</strong>
              <small>
                {new Date(c.expires_at).toLocaleDateString('ko-KR')}{' '}
                {c.oauth ? '미사용 시 만료' : '만료'}
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
