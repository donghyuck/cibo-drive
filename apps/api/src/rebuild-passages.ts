import pg from 'pg';
import { rebuildPassages } from './passages.js';

const [fileId, ...extra] = process.argv.slice(2);
if (!process.env.DATABASE_URL || !fileId || extra.length)
  throw new Error('DATABASE_URL을 설정하고 파일 ID 하나를 지정하세요.');
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  if (!(await rebuildPassages(db, fileId)))
    throw new Error('본문 추출이 완료된 파일 ID를 확인하세요.');
  console.log('검색 문단을 재생성했습니다.');
} finally {
  await db.end();
}
