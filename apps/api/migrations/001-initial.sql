CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), issuer text NOT NULL, subject text NOT NULL,
  email text NOT NULL, status text NOT NULL CHECK (status IN ('pending','active','suspended')),
  role text NOT NULL CHECK (role IN ('admin','editor','viewer')), UNIQUE(issuer,subject)
);
CREATE TABLE IF NOT EXISTS spaces (id integer PRIMARY KEY, name text NOT NULL);
CREATE TABLE IF NOT EXISTS memberships (
  account_id uuid REFERENCES accounts PRIMARY KEY, space_id integer REFERENCES spaces NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  digest text PRIMARY KEY, account_id uuid REFERENCES accounts NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), space_id integer REFERENCES spaces NOT NULL,
  parent_id uuid REFERENCES entries, name text NOT NULL, object_key uuid UNIQUE,
  created_by uuid REFERENCES accounts, UNIQUE(parent_id,name)
);
CREATE UNIQUE INDEX IF NOT EXISTS single_root ON entries(space_id) WHERE parent_id IS NULL;
CREATE INDEX IF NOT EXISTS entries_parent ON entries(parent_id);
CREATE TABLE IF NOT EXISTS changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor uuid REFERENCES accounts NOT NULL,
  action text NOT NULL, target uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE accounts IS '사용자 계정';
COMMENT ON COLUMN accounts.id IS '계정 식별자';
COMMENT ON COLUMN accounts.issuer IS '인증 발급자 식별자';
COMMENT ON COLUMN accounts.subject IS '발급자 내 사용자 식별자. 발급자와 조합하여 계정을 식별한다.';
COMMENT ON COLUMN accounts.email IS '인증 발급자가 확인한 전자우편주소';
COMMENT ON COLUMN accounts.status IS '계정 상태 코드. pending 승인 대기, active 활성, suspended 정지';
COMMENT ON COLUMN accounts.role IS '사용자 역할 코드. admin 관리자, editor 편집자, viewer 조회자';
COMMENT ON TABLE spaces IS '문서 공간';
COMMENT ON COLUMN spaces.id IS '문서 공간 식별자';
COMMENT ON COLUMN spaces.name IS '문서 공간명';
COMMENT ON TABLE memberships IS '계정별 문서 공간 접근 부여 내역';
COMMENT ON COLUMN memberships.account_id IS '접근을 부여받은 계정 식별자';
COMMENT ON COLUMN memberships.space_id IS '접근이 허용된 문서 공간 식별자';
COMMENT ON TABLE sessions IS '웹 로그인 세션';
COMMENT ON COLUMN sessions.digest IS '세션 토큰의 SHA-256 해시값';
COMMENT ON COLUMN sessions.account_id IS '로그인한 계정 식별자';
COMMENT ON COLUMN sessions.expires_at IS '세션 만료 일시';
COMMENT ON TABLE entries IS '문서 공간의 폴더 및 파일';
COMMENT ON COLUMN entries.id IS '파일 또는 폴더 식별자. 이름과 경로 변경 후에도 유지한다.';
COMMENT ON COLUMN entries.space_id IS '소속 문서 공간 식별자';
COMMENT ON COLUMN entries.parent_id IS '상위 폴더 식별자. 루트 폴더는 NULL이다.';
COMMENT ON COLUMN entries.name IS '폴더명 또는 확장자를 포함한 파일명';
COMMENT ON COLUMN entries.object_key IS '비공개 저장소의 원본 객체 키. 폴더는 NULL이다.';
COMMENT ON COLUMN entries.created_by IS '생성한 계정 식별자. 시스템이 생성한 루트 폴더는 NULL이다.';
COMMENT ON TABLE changes IS '계정 및 파일 작업 이력';
COMMENT ON COLUMN changes.id IS '변경 이력 일련번호';
COMMENT ON COLUMN changes.actor IS '작업을 수행한 계정 식별자';
COMMENT ON COLUMN changes.action IS '작업 유형 코드. account.update 계정 변경, folder.create 폴더 생성, file.upload 파일 업로드';
COMMENT ON COLUMN changes.target IS '작업 대상 식별자. 계정 변경은 accounts.id, 폴더 생성과 파일 업로드는 entries.id를 참조한다.';
COMMENT ON COLUMN changes.recorded_at IS '변경 이력 기록 일시';
INSERT INTO spaces VALUES (1,'팀 문서 공간') ON CONFLICT DO NOTHING;
INSERT INTO entries(space_id,name) VALUES(1,'팀 문서 공간') ON CONFLICT DO NOTHING;
