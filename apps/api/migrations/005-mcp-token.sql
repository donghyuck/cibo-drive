CREATE TABLE mcp_acs_tkn (
  tkn_idntfr uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  acnt_idntfr uuid NOT NULL REFERENCES user_acnt ON DELETE CASCADE,
  doc_space_idntfr integer NOT NULL REFERENCES doc_space,
  tkn_nm text NOT NULL,
  tkn_sha256 text NOT NULL UNIQUE,
  reg_dt timestamptz NOT NULL DEFAULT now(),
  expry_dt timestamptz NOT NULL DEFAULT now() + interval '30 days'
);
CREATE INDEX mcp_acs_tkn_account ON mcp_acs_tkn(acnt_idntfr);
COMMENT ON TABLE mcp_acs_tkn IS '사용자별 문서 공간 읽기 전용 MCP 접근 토큰';
COMMENT ON COLUMN mcp_acs_tkn.tkn_idntfr IS '토큰 관리 식별자';
COMMENT ON COLUMN mcp_acs_tkn.acnt_idntfr IS '발급 계정 식별자';
COMMENT ON COLUMN mcp_acs_tkn.doc_space_idntfr IS '발급 시점의 문서 공간 식별자';
COMMENT ON COLUMN mcp_acs_tkn.tkn_nm IS '사용자가 지정한 연결 이름';
COMMENT ON COLUMN mcp_acs_tkn.tkn_sha256 IS '접근 토큰 SHA-256 해시';
COMMENT ON COLUMN mcp_acs_tkn.reg_dt IS '발급 일시';
COMMENT ON COLUMN mcp_acs_tkn.expry_dt IS '만료 일시';
