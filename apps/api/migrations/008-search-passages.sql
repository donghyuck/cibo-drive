ALTER TABLE doc_artcl_txt ADD COLUMN srch_sctn_list jsonb;
COMMENT ON COLUMN doc_artcl_txt.srch_sctn_list IS '검색 구간 목록. 파일 식별자에 귀속되는 출처·본문 순서 배열. NULL은 미생성';
CREATE INDEX doc_artcl_txt_passages_pending ON doc_artcl_txt(artcl_idntfr)
WHERE prcs_stts_cd='ready' AND srch_sctn_list IS NULL;
