ALTER TABLE doc_artcl_txt ADD COLUMN thmb_img bytea CHECK(octet_length(thmb_img)<=65536),
 ADD COLUMN thmb_cn varchar(180), ADD COLUMN thmb_prcs_yn boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN doc_artcl_txt.thmb_img IS '목록용 축소 JPEG (최대 64 KiB)';
COMMENT ON COLUMN doc_artcl_txt.thmb_cn IS '이미지 없는 문서의 카드용 본문 발췌';
COMMENT ON COLUMN doc_artcl_txt.thmb_prcs_yn IS '썸네일 생성 시도 완료 여부';
INSERT INTO doc_artcl_txt(artcl_idntfr) SELECT artcl_idntfr FROM doc_artcl
 WHERE s3_objt_key IS NOT NULL AND lower(artcl_nm) LIKE '%.epub'
 ON CONFLICT DO NOTHING;
CREATE INDEX doc_artcl_txt_thumbnail_pending ON doc_artcl_txt(artcl_idntfr) WHERE NOT thmb_prcs_yn;
