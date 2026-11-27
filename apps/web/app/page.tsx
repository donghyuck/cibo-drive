export default function Drive() {
  return (
    <main className="shell">
      <aside aria-label="워크스페이스">
        <strong>Cibo Drive</strong>
        <p>팀 파일 저장소</p>
        <span className="selected" aria-current="page">내 파일</span>
      </aside>
      <section aria-labelledby="files-heading">
        <header><h1 id="files-heading">내 파일</h1><span className="badge">개발 미리보기</span></header>
        <div className="empty">
          <h2>파일 공간을 준비하고 있어요</h2>
          <p>Google 로그인과 관리자 승인이 연결되면 여기에서 파일을 관리할 수 있습니다.</p>
        </div>
      </section>
    </main>
  );
}
