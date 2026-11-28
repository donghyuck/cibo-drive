ALTER TABLE mcp_acs_tkn
  ADD COLUMN oauth_rsrc_url text,
  ADD COLUMN oauth_redirect_url text,
  ADD COLUMN pkce_challenge text,
  ADD COLUMN rfrsh_tkn_sha256 text UNIQUE,
  ADD COLUMN rfrsh_expry_dt timestamptz;

COMMENT ON COLUMN mcp_acs_tkn.oauth_rsrc_url IS 'OAuth 토큰이 발급된 MCP 리소스 주소';
COMMENT ON COLUMN mcp_acs_tkn.oauth_redirect_url IS '인증 코드 발급 시 검증한 콜백 주소';
COMMENT ON COLUMN mcp_acs_tkn.pkce_challenge IS '미사용 인증 코드의 S256 PKCE 챌린지';
COMMENT ON COLUMN mcp_acs_tkn.rfrsh_tkn_sha256 IS '현재 갱신 토큰의 SHA-256 해시';
COMMENT ON COLUMN mcp_acs_tkn.rfrsh_expry_dt IS '마지막 갱신부터 계산한 연결 만료 일시';
