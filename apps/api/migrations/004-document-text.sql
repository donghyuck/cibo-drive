CREATE TABLE doc_artcl_txt (
  artcl_idntfr uuid PRIMARY KEY REFERENCES doc_artcl ON DELETE CASCADE,
  prcs_stts_cd text NOT NULL DEFAULT 'processing' CHECK (prcs_stts_cd IN ('processing','ready','empty','failed')),
  src_sctn_list jsonb NOT NULL DEFAULT '[]',
  fail_rsn text
);
COMMENT ON TABLE doc_artcl_txt IS '문서 항목별 본문 추출 작업 및 결과';
COMMENT ON COLUMN doc_artcl_txt.artcl_idntfr IS '원본 파일 식별자';
COMMENT ON COLUMN doc_artcl_txt.prcs_stts_cd IS '처리 상태 코드. processing은 대기 및 추출 중';
COMMENT ON COLUMN doc_artcl_txt.src_sctn_list IS '출처 단위, 시작·종료 위치 및 추출 본문 목록';
COMMENT ON COLUMN doc_artcl_txt.fail_rsn IS '추출 실패 사유';
CREATE INDEX doc_artcl_txt_pending ON doc_artcl_txt(artcl_idntfr) WHERE prcs_stts_cd='processing';
INSERT INTO doc_artcl_txt(artcl_idntfr) SELECT artcl_idntfr FROM doc_artcl WHERE s3_objt_key IS NOT NULL;
