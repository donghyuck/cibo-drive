ALTER TABLE doc_artcl_txt
  ADD COLUMN idx_stts_cd text NOT NULL DEFAULT 'pending' CHECK (idx_stts_cd IN ('pending','ready','failed')),
  ADD COLUMN idx_mdl_nm text,
  ADD COLUMN idx_fail_rsn text;
CREATE INDEX doc_artcl_txt_index_queue ON doc_artcl_txt(idx_stts_cd,artcl_idntfr)
  WHERE prcs_stts_cd='ready' AND srch_sctn_list IS NOT NULL;

CREATE TABLE doc_sctn_idx (
  artcl_idntfr uuid NOT NULL REFERENCES doc_artcl_txt ON DELETE CASCADE,
  sctn_sn integer NOT NULL CHECK (sctn_sn >= 0),
  emb_vctr real[] NOT NULL CHECK (cardinality(emb_vctr) > 0),
  PRIMARY KEY (artcl_idntfr,sctn_sn)
);

-- Applies to extraction, passage rebuilds and already deployed writers.
CREATE FUNCTION invalidate_passage_index() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM doc_sctn_idx WHERE artcl_idntfr=OLD.artcl_idntfr;
  NEW.idx_stts_cd := 'pending';
  NEW.idx_mdl_nm := NULL;
  NEW.idx_fail_rsn := NULL;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invalidate_passage_index BEFORE UPDATE OF srch_sctn_list,prcs_stts_cd ON doc_artcl_txt
FOR EACH ROW WHEN (OLD.srch_sctn_list IS DISTINCT FROM NEW.srch_sctn_list OR OLD.prcs_stts_cd IS DISTINCT FROM NEW.prcs_stts_cd)
EXECUTE FUNCTION invalidate_passage_index();
