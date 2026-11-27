ALTER TABLE accounts RENAME TO user_acnt;
ALTER TABLE user_acnt RENAME COLUMN id TO acnt_idntfr;
ALTER TABLE user_acnt RENAME COLUMN issuer TO oidc_issuer;
ALTER TABLE user_acnt RENAME COLUMN subject TO oidc_subject;
ALTER TABLE user_acnt RENAME COLUMN email TO user_eml_addr;
ALTER TABLE user_acnt RENAME COLUMN status TO acnt_stts_cd;
ALTER TABLE user_acnt RENAME COLUMN role TO role_cd;

ALTER TABLE spaces RENAME TO doc_space;
ALTER TABLE doc_space RENAME COLUMN id TO doc_space_idntfr;
ALTER TABLE doc_space RENAME COLUMN name TO doc_space_nm;

ALTER TABLE memberships RENAME TO doc_space_acs_authrt;
ALTER TABLE doc_space_acs_authrt RENAME COLUMN account_id TO acnt_idntfr;
ALTER TABLE doc_space_acs_authrt RENAME COLUMN space_id TO doc_space_idntfr;

ALTER TABLE sessions RENAME TO lgn_ssn;
ALTER TABLE lgn_ssn RENAME COLUMN digest TO ssn_tkn_sha256;
ALTER TABLE lgn_ssn RENAME COLUMN account_id TO acnt_idntfr;
ALTER TABLE lgn_ssn RENAME COLUMN expires_at TO expry_dt;

ALTER TABLE entries RENAME TO doc_artcl;
ALTER TABLE doc_artcl RENAME COLUMN id TO artcl_idntfr;
ALTER TABLE doc_artcl RENAME COLUMN space_id TO doc_space_idntfr;
ALTER TABLE doc_artcl RENAME COLUMN parent_id TO up_artcl_idntfr;
ALTER TABLE doc_artcl RENAME COLUMN name TO artcl_nm;
ALTER TABLE doc_artcl RENAME COLUMN object_key TO s3_objt_key;
ALTER TABLE doc_artcl RENAME COLUMN created_by TO creatr_acnt_idntfr;

ALTER TABLE changes RENAME TO chg_hstry;
ALTER TABLE chg_hstry RENAME COLUMN id TO chg_hstry_sn;
ALTER TABLE chg_hstry RENAME COLUMN actor TO oprtr_acnt_idntfr;
ALTER TABLE chg_hstry RENAME COLUMN action TO job_type_cd;
ALTER TABLE chg_hstry RENAME COLUMN target TO trgt_idntfr;
ALTER TABLE chg_hstry RENAME COLUMN recorded_at TO rcd_dt;

COMMENT ON COLUMN chg_hstry.trgt_idntfr IS '작업 대상 식별자. 계정 변경은 user_acnt.acnt_idntfr, 폴더 생성과 파일 업로드는 doc_artcl.artcl_idntfr를 참조한다.';
