import pg from 'pg';
import { retryIndex } from './embeddings.js';
const [command, id, ...extra] = process.argv.slice(2);
if (
  !process.env.DATABASE_URL ||
  extra.length ||
  !((command === 'failed' && !id) || (command === 'retry' && id))
)
  throw new Error('npm run embeddings -- failed | retry <파일 UUID>');
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  if (id) {
    if (!(await retryIndex(db, id)))
      throw new Error('색인에 실패한 파일 ID를 확인하세요.');
    console.log('재시도 대기열에 등록했습니다.');
  } else {
    console.table(
      (
        await db.query(
          "SELECT artcl_idntfr,idx_mdl_nm,idx_fail_rsn FROM doc_artcl_txt WHERE idx_stts_cd='failed' ORDER BY artcl_idntfr",
        )
      ).rows,
    );
  }
} finally {
  await db.end();
}
