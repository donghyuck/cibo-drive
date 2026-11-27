# 유휴 서버에서 SeaweedFS 단독 실행

로컬 PC에서 웹·API를 실행하고, PostgreSQL은 기존 `dev-postgres-vm`, S3 원본은 `instance-mysql`에 둔다. 아래 명령은 Docker Engine과 Compose 플러그인이 설치된 지원 대상 Linux에서 사용한다. 현재 CentOS 7 서버는 OS 전환 후 적용한다.

1. 서버의 데이터 볼륨을 마운트한 뒤 `mountpoint /srv/cibo-volume && sudo install -d -m 700 /srv/cibo-volume/objects`로 디렉터리를 준비한다. 재부팅 시 Docker보다 먼저 마운트되도록 설정한다.
2. 이 디렉터리의 `compose.yml`과 `.env.example`을 서버의 전용 디렉터리에 복사한다. 해당 디렉터리에서 최초 한 번 다음 명령을 실행한다. 이미 사용 중인 키와 버킷이 있으면 기존 값을 사용한다.

```sh
test -e .env || (umask 077; sed \
  -e "s/^S3_ACCESS_KEY_ID=$/S3_ACCESS_KEY_ID=$(openssl rand -hex 16)/" \
  -e "s/^S3_SECRET_ACCESS_KEY=$/S3_SECRET_ACCESS_KEY=$(openssl rand -hex 32)/" \
  .env.example > .env)
docker compose config --quiet
docker compose up -d
docker compose ps
```

3. 로컬 PC에서 SSH 터널을 유지한다. SSH 대상은 실제 서버의 계정·주소 또는 등록한 별칭으로 교체한다.

```sh
ssh -NT -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -L 127.0.0.1:18333:127.0.0.1:8333 ubuntu@APP_HOST
```

4. 로컬 저장소 루트의 `.env`에서 `S3_ENDPOINT=http://127.0.0.1:18333`을 설정하고 `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`를 서버와 일치시킨다. `DATABASE_URL`은 접근 가능한 기존 PostgreSQL 전용 DB 주소를 사용한다. `npm run infra:check`에서 DB와 버킷 연결을 확인한 후 `npm run dev`로 앱을 시작한다.

기존 파일이 있으면 쓰기를 멈추고 원본을 동일한 객체 키로 새 버킷에 복사한 뒤 연결을 전환한다. 파일 개수와 다운로드 체크섬을 확인한다. 원본과 DB 백업은 같은 시점 기준으로 서버 밖에 보관한다. S3 포트는 루프백에만 게시하며 OCI 인바운드 규칙에 추가할 필요가 없다.
