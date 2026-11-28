# M1 PostgreSQL 물리명 대조표

행정안전부가 공공데이터포털에 게시한 8차(2025년 11월) [공통표준용어 CSV](https://www.data.go.kr/data/15156379/fileData.do)와 [공통표준단어 CSV](https://www.data.go.kr/data/15156439/fileData.do)를 기준으로 작성했다. PostgreSQL 식별자는 소문자로 표기한다. 테이블은 업무 개체의 단어 조합으로 명명했다. 컬럼의 등록 용어는 의미와 영문약어를 대조했으며, 표준 도메인은 참고값으로 병기했다. 이번 이전은 물리명 변경으로 자료형과 기존 값은 유지한다.

| 종류 | 기존 물리명 | 새 물리명 | 근거 |
|---|---|---|---|
| 테이블 | `accounts` | `user_acnt` | 표준단어 조합 · 사용자 + 계정 |
| 컬럼 | `accounts.id` | `user_acnt.acnt_idntfr` | 표준단어 조합 · 계정 + 식별자 |
| 컬럼 | `accounts.issuer` | `user_acnt.oidc_issuer` | 프로젝트 조합 · OIDC + 발급자 클레임 |
| 컬럼 | `accounts.subject` | `user_acnt.oidc_subject` | 프로젝트 조합 · OIDC + 사용자 클레임 |
| 컬럼 | `accounts.email` | `user_acnt.user_eml_addr` | 등록 용어 사용자이메일주소 · USER_EML_ADDR · 주소V320 |
| 컬럼 | `accounts.status` | `user_acnt.acnt_stts_cd` | 표준단어 조합 · 계정 + 상태 + 코드 |
| 컬럼 | `accounts.role` | `user_acnt.role_cd` | 표준단어 조합 · 역할 + 코드 |
| 테이블 | `spaces` | `doc_space` | 프로젝트 조합 · 문서 + 공간 |
| 컬럼 | `spaces.id` | `doc_space.doc_space_idntfr` | 프로젝트 조합 · 문서 + 공간 + 식별자 |
| 컬럼 | `spaces.name` | `doc_space.doc_space_nm` | 프로젝트 조합 · 문서 + 공간 + 명 |
| 테이블 | `memberships` | `doc_space_acs_authrt` | 프로젝트 조합 · 문서 + 공간 + 접근 + 권한 |
| 컬럼 | `memberships.account_id` | `doc_space_acs_authrt.acnt_idntfr` | 표준단어 조합 · 계정 + 식별자 |
| 컬럼 | `memberships.space_id` | `doc_space_acs_authrt.doc_space_idntfr` | 프로젝트 조합 · 문서 + 공간 + 식별자 |
| 테이블 | `sessions` | `lgn_ssn` | 표준단어 조합 · 로그인 + 세션 |
| 컬럼 | `sessions.digest` | `lgn_ssn.ssn_tkn_sha256` | 프로젝트 조합 · 세션 + 토큰 + SHA-256 |
| 컬럼 | `sessions.account_id` | `lgn_ssn.acnt_idntfr` | 표준단어 조합 · 계정 + 식별자 |
| 컬럼 | `sessions.expires_at` | `lgn_ssn.expry_dt` | 등록 용어 만료일시 · EXPRY_DT · 연월일시분초D |
| 테이블 | `entries` | `doc_artcl` | 표준단어 조합 · 문서 + 항목 |
| 컬럼 | `entries.id` | `doc_artcl.artcl_idntfr` | 표준단어 조합 · 항목 + 식별자 |
| 컬럼 | `entries.space_id` | `doc_artcl.doc_space_idntfr` | 프로젝트 조합 · 문서 + 공간 + 식별자 |
| 컬럼 | `entries.parent_id` | `doc_artcl.up_artcl_idntfr` | 표준단어 조합 · 상위 + 항목 + 식별자 |
| 컬럼 | `entries.name` | `doc_artcl.artcl_nm` | 등록 용어 항목명 · ARTCL_NM · 명V100 |
| 컬럼 | `entries.object_key` | `doc_artcl.s3_objt_key` | 프로젝트 조합 · S3 + 객체 + 객체 키 |
| 컬럼 | `entries.created_by` | `doc_artcl.creatr_acnt_idntfr` | 표준단어 조합 · 생성자 + 계정 + 식별자 |
| 테이블 | `changes` | `chg_hstry` | 표준단어 조합 · 변경 + 이력 |
| 컬럼 | `changes.id` | `chg_hstry.chg_hstry_sn` | 등록 용어 변경이력일련번호 · CHG_HSTRY_SN · 일련번호N22 |
| 컬럼 | `changes.actor` | `chg_hstry.oprtr_acnt_idntfr` | 표준단어 조합 · 작업자 + 계정 + 식별자 |
| 컬럼 | `changes.action` | `chg_hstry.job_type_cd` | 표준단어 조합 · 작업 + 유형 + 코드 |
| 컬럼 | `changes.target` | `chg_hstry.trgt_idntfr` | 표준단어 조합 · 대상 + 식별자 |
| 컬럼 | `changes.recorded_at` | `chg_hstry.rcd_dt` | 등록 용어 기록일시 · RCD_DT · 연월일시분초D |
| 신규 컬럼 | — | `doc_artcl.file_sz` | 등록 용어 파일크기 · FILE_SZ · 바이트 |
| 신규 컬럼 | — | `doc_artcl.reg_dt` | 등록 용어 등록일시 · REG_DT |
| 신규 테이블 | — | `mcp_acs_tkn` | 사용자별 문서 공간 MCP 접근 토큰 |
| 신규 컬럼 | — | `mcp_acs_tkn.tkn_idntfr` | 토큰 관리 식별자 |
| 신규 컬럼 | — | `mcp_acs_tkn.acnt_idntfr` | 계정 식별자 |
| 신규 컬럼 | — | `mcp_acs_tkn.doc_space_idntfr` | 발급 당시 문서 공간 식별자 |
| 신규 컬럼 | — | `mcp_acs_tkn.tkn_nm` | 토큰명 · 사용자가 지정한 연결 이름 |
| 신규 컬럼 | — | `mcp_acs_tkn.tkn_sha256` | 프로젝트 조합 · 토큰 + SHA-256 |
| 신규 컬럼 | — | `mcp_acs_tkn.reg_dt` | 등록일시 · REG_DT |
| 신규 컬럼 | — | `mcp_acs_tkn.expry_dt` | 만료일시 · EXPRY_DT |
| 신규 컬럼 | — | `doc_artcl_txt.thmb_img` | 프로젝트 용어 · 목록용 축소 이미지 |
| 신규 컬럼 | — | `doc_artcl_txt.thmb_cn` | 프로젝트 용어 · 목록용 본문 발췌 |
| 신규 컬럼 | — | `doc_artcl_txt.thmb_prcs_yn` | 프로젝트 용어 · 썸네일 처리 여부 |
| 신규 테이블 | — | `doc_artcl_txt` | 표준단어 조합 · 문서 + 항목 + 텍스트 |
| 신규 컬럼 | — | `doc_artcl_txt.artcl_idntfr` | 문서 항목 식별자 · 원본 파일 외래 키 |
| 신규 컬럼 | — | `doc_artcl_txt.prcs_stts_cd` | 표준단어 조합 · 처리 + 상태 + 코드 |
| 신규 컬럼 | — | `doc_artcl_txt.src_sctn_list` | 표준단어 조합 · 출처 + 구간 + 목록 |
| 신규 컬럼 | — | `doc_artcl_txt.srch_sctn_list` | 프로젝트 조합 · 검색 + 구간 + 목록 · 원본 파일별 순서가 있는 JSON 배열 |
| 신규 컬럼 | — | `doc_artcl_txt.fail_rsn` | 등록 용어 실패사유 · FAIL_RSN |
| 신규 컬럼 | — | `doc_artcl.del_dt` | 삭제일시 · DEL_DT · 논리 삭제 시각 |
| 신규 컬럼 | — | `doc_artcl.del_grp_idntfr` | 프로젝트 조합 · 삭제 + 그룹 + 식별자 · 함께 복원하는 하위 트리 루트 ID |
| 신규 컬럼 | — | `doc_artcl_txt.idx_stts_cd` | 프로젝트 조합 · 색인 상태 코드 |
| 신규 컬럼 | — | `doc_artcl_txt.idx_mdl_nm` | 프로젝트 조합 · 색인 모델명과 차원 |
| 신규 컬럼 | — | `doc_artcl_txt.idx_fail_rsn` | 프로젝트 조합 · 색인 실패 사유 |
| 신규 테이블 | — | `doc_sctn_idx` | 프로젝트 조합 · 문서 구간 색인 |
| 신규 컬럼 | — | `doc_sctn_idx.artcl_idntfr` | 원본 문서 항목 식별자 |
| 신규 컬럼 | — | `doc_sctn_idx.sctn_sn` | 구간 순번 · 0부터 시작 |
| 신규 컬럼 | — | `doc_sctn_idx.emb_vctr` | 프로젝트 용어 · 임베딩 벡터 |

`space`는 팀의 문서 공간을 가리키는 프로젝트 단어다. OIDC의 발급자·사용자 클레임, 세션 토큰의 해시 알고리즘, S3 객체 키는 연동 규격상의 의미를 보존한다. 내부 계정 UUID에는 식별자(IDNTFR)를 사용한다. 파일·폴더 항목명은 기존 최대 200자 정책을 유지하므로 명V100과 길이가 다르다. 계정 상태·역할의 실제 코드값은 프로젝트에서 관리한다.
