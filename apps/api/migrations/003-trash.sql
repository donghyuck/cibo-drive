ALTER TABLE doc_artcl ADD COLUMN IF NOT EXISTS del_grp_idntfr uuid;
ALTER TABLE doc_artcl ADD COLUMN IF NOT EXISTS del_dt timestamptz;
COMMENT ON COLUMN doc_artcl.del_grp_idntfr IS '휴지통 이동 그룹 식별자. 함께 이동한 최상위 항목의 ID이며 활성 항목은 NULL이다.';
COMMENT ON COLUMN doc_artcl.del_dt IS '휴지통 이동 일시. 복원하면 NULL이다.';
ALTER TABLE doc_artcl DROP CONSTRAINT IF EXISTS entries_parent_id_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS doc_artcl_active_name ON doc_artcl(up_artcl_idntfr,artcl_nm) WHERE del_grp_idntfr IS NULL;
CREATE INDEX IF NOT EXISTS doc_artcl_trash_group ON doc_artcl(del_grp_idntfr) WHERE del_grp_idntfr IS NOT NULL;
