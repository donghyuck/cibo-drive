ALTER TABLE doc_artcl ADD COLUMN file_sz bigint CHECK (file_sz >= 0), ADD COLUMN reg_dt timestamptz;
COMMENT ON COLUMN doc_artcl.file_sz IS '파일크기. 원본 바이트 수. 폴더는 NULL';
COMMENT ON COLUMN doc_artcl.reg_dt IS '등록일시. 파일 업로드 또는 폴더 생성 시각';
UPDATE doc_artcl a SET reg_dt=h.created FROM (
  SELECT trgt_idntfr, min(rcd_dt) AS created FROM chg_hstry
  WHERE job_type_cd IN ('file.upload','folder.create') GROUP BY trgt_idntfr
) h WHERE a.artcl_idntfr=h.trgt_idntfr;
ALTER TABLE doc_artcl ALTER COLUMN reg_dt SET DEFAULT now();
