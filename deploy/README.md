# OCI 1코어·1GB 서버에 Cibo Drive 설치

기존 PostgreSQL 서버에 전용 DB를 만들고, 유휴 Linux VM에서 Caddy, Cibo API, SeaweedFS를 실행한다. 브라우저는 HTTPS 한 주소를 사용한다. Caddy가 미리 빌드한 웹 파일을 제공하고 `/api/*`를 내부 API로 전달한다. API는 기존 DB에 메타데이터를, SeaweedFS의 비공개 버킷에 파일 원본을 저장한다.

로컬에서 앱을 실행하고 유휴 서버에는 원본만 보관하려면 [SeaweedFS 단독 배포](storage/README.md)를 사용한다.

## OCI Object Storage에 직접 연결

로컬 웹·API와 기존 PostgreSQL을 사용하는 경우 원본을 OCI의 비공개 Standard 버킷에 저장할 수 있다. 루트 `.env`의 `S3_ENDPOINT`에는 `https://<namespace>.compat.objectstorage.ap-seoul-1.oci.customer-oci.com`, `S3_REGION`에는 `ap-seoul-1`, `S3_BUCKET`에는 전용 버킷명을 입력한다. 앱 전용 IAM 사용자의 Customer Secret Key 쌍을 `S3_ACCESS_KEY_ID`와 `S3_SECRET_ACCESS_KEY`에 설정한다. 키 파일 권한을 600으로 제한하고, 같은 환경 파일의 OCI 키를 개발용 SeaweedFS 컨테이너에 전달하지 않는다.

저장소 연결은 `npm run infra:check`로 확인한다. `npm run test:drive`는 지정한 DB에 임시 스키마를 만들고 지정한 버킷에 시험 객체를 쓴 뒤 정리한다. API는 `npm run dev`를 다시 시작할 때 새 환경을 읽는다.

## 기존 DB를 사용해 로컬에서 먼저 운영하기

PostgreSQL은 기존 `dev-postgres-vm`의 Cibo 전용 DB를 사용한다. 로컬 PC에서는 웹·API를 실행하고 SeaweedFS만 Docker로 띄울 수 있다. 저장소 루트의 `.env`를 준비하고, `DATABASE_URL`에는 VPN 등으로 접근할 수 있는 DB의 실제 사설 DNS 이름과 전용 계정을 입력한다. OCI 콘솔의 VM 표시 이름은 DNS 이름과 다를 수 있다. 최초 DB·역할 생성과 TLS 설정은 아래 2절을 따른다.

```sh
# 저장소 루트에서 실행. 기존 .env가 있으면 유지한다.
test -f .env || cp .env.example .env
# .env의 DATABASE_URL, Google 설정 및 S3 설정을 입력한 후
npm ci
python3 -m venv apps/api/extraction/.venv
apps/api/extraction/.venv/bin/pip install -r apps/api/extraction/requirements.txt
docker compose up -d --wait objects
npm run infra:check
npm run dev
```

이 구성에서는 계정·권한·파일 목록은 처음부터 원격 DB에 저장되고, 원본은 로컬 SeaweedFS 볼륨에 저장된다. 앱과 저장소를 OCI로 옮길 때에는 쓰기를 중지하고 DB를 백업한 후 원본을 같은 객체 키로 복사한다. 새 앱에 같은 DB와 새 S3 접속 정보를 설정하고 다운로드를 검증한 뒤 전환한다. 동일 DB에 서로 다른 원본 저장소를 사용하는 앱 두 개가 동시에 쓰지 않도록 한다.

## 1. 서버와 도메인 준비

- 유휴 서버에서 `uname -m`, `free -h`, `df -h`, `swapon --show`, `docker compose version`을 확인한다. Docker Engine과 Compose 플러그인이 필요하다. 컨테이너 상한은 웹 64 MiB, API 232 MiB, 저장소 352 MiB로 합계 648 MiB다. 나머지는 OS와 Docker가 사용한다. 소수 사용자의 파일럿을 가정한 시작값이다. CPU 한 개를 세 서비스가 공유한다.
- 도메인의 A 레코드를 유휴 서버의 공인 IP에 연결한다. AAAA 레코드가 있으면 IPv6도 올바르게 연결한다. OCI 보안 규칙과 OS 방화벽에서 TCP 80·443을 허용하고, SSH는 관리자의 접속 경로로 제한한다. Caddy가 인증서 발급·갱신을 담당하므로 서버에서 외부 HTTPS로 접속할 수 있어야 한다.
- 파일을 저장할 볼륨을 마운트하고 재부팅 후에도 같은 경로가 되도록 설정한다. 예를 들어 `/srv/cibo-volume`이 마운트 지점이라면 `mountpoint /srv/cibo-volume && sudo install -d -m 700 /srv/cibo-volume/objects`로 데이터 디렉터리를 만든다. `.env`의 `OBJECT_DATA_DIR`에 이 절대경로를 입력한다. OS 디스크의 빈 디렉터리로 잘못 기동하지 않도록 마운트 후 Docker를 시작한다.
- Google 웹 OAuth 클라이언트의 승인된 JavaScript 원본에 실제 주소(예: `https://drive.example.org`)를 등록한다. 클라이언트 ID와 마스터 관리자의 검증된 Google `sub`를 준비한다.

## 2. 기존 PostgreSQL 서버 준비

DB 관리자 권한으로 `psql`에서 전용 역할과 DB를 최초 한 번 만든다. 비밀번호는 프롬프트에서 입력한다.

```sql
CREATE ROLE cibo LOGIN;
\password cibo
CREATE DATABASE cibo OWNER cibo;
```

API는 시작할 때 이 DB에 테이블과 마이그레이션을 적용한다. 기존 M1 데이터가 있는 전용 DB라면 같은 소유 역할을 사용하고 먼저 백업한다. 다른 서비스와는 DB를 분리한다.

DB 서버가 사설 인터페이스에서 접속을 받도록 설정하고 TCP 5432는 앱 VM의 사설 IP에서만 허용한다. TLS를 구성한 PostgreSQL의 `pg_hba.conf` 예시는 다음과 같다. 주소를 실제 앱 VM의 사설 IP로 바꾸고 기존 인증 규칙과 순서를 확인한 후 구성을 다시 읽는다.

```text
hostssl  cibo  cibo  10.0.1.25/32  scram-sha-256
```

`DATABASE_URL`의 호스트명은 DB 인증서와 일치해야 하며 앱 VM에서 사설 IP로 해석되어야 한다. 비밀번호의 특수 문자는 URL 인코딩한다. 기본 예시는 `sslmode=verify-full`이다. 사설 CA라면 배포 디렉터리에 공개 CA 인증서 `db-ca.pem`과 다음 `compose.override.yaml`을 두고, URL에 `&sslrootcert=/etc/cibo/db-ca.pem`을 추가한다. 이후 모든 Compose 명령에 `-f compose.yml -f compose.override.yaml`을 사용한다.

```yaml
services:
  api:
    volumes:
      - ./db-ca.pem:/etc/cibo/db-ca.pem:ro
```

## 3. 개발 PC 또는 CI에서 이미지 빌드

배포할 커밋을 체크아웃한 저장소 루트에서 실행한다. 대상 서버의 `uname -m`이 `x86_64`이면 `linux/amd64`, `aarch64`이면 `linux/arm64`를 지정한다. 다른 아키텍처에서 빌드하려면 해당 플랫폼을 지원하는 Buildx 빌더가 필요하다.

```sh
platform=linux/amd64
release=$(git rev-parse --short HEAD)
docker buildx build --platform "$platform" --load -f deploy/Dockerfile --target api -t "cibo-api:$release" .
docker buildx build --platform "$platform" --load -f deploy/Dockerfile --target web -t "cibo-web:$release" .
docker save "cibo-api:$release" "cibo-web:$release" | gzip > "cibo-$release.tar.gz"
ssh ubuntu@APP_HOST 'install -d -m 700 ~/cibo'
scp "cibo-$release.tar.gz" deploy/compose.yml deploy/.env.example ubuntu@APP_HOST:~/cibo/
```

`ubuntu@APP_HOST`는 실제 SSH 접속 대상으로 바꾼다. Caddy 설정과 정적 웹은 웹 이미지 안에 포함된다.

## 4. 유휴 서버에서 실행

```sh
cd ~/cibo
release=abc1234  # 전송한 이미지의 실제 커밋 태그
gzip -dc "cibo-$release.tar.gz" | docker load
install -m 600 .env.example .env
```

`.env`에 다음 값을 입력한다.

| 항목 | 값 |
|---|---|
| SITE_DOMAIN | 프로토콜·경로를 제외한 도메인 |
| API_IMAGE / WEB_IMAGE | 빌드한 태그 두 개. 예: `cibo-api:abc1234`, `cibo-web:abc1234` |
| DATABASE_URL | 기존 서버의 전용 DB 접속 문자열 |
| GOOGLE_CLIENT_ID / CIBO_MASTER_GOOGLE_SUB | Google 웹 클라이언트 ID와 최초 관리자 식별자 |
| S3_BUCKET | 소문자 버킷 이름. 최초 실행 때 SeaweedFS가 생성 |
| S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY | 이 배포만 사용하는 자격증명. 각각 `openssl rand -hex 16`, `openssl rand -hex 32`로 생성 가능 |
| OBJECT_DATA_DIR | 마운트 및 생성한 원본 데이터 디렉터리의 절대경로 |

```sh
docker compose -f compose.yml config --quiet
docker compose -f compose.yml pull objects
docker compose -f compose.yml up -d --wait
docker compose -f compose.yml ps
docker compose -f compose.yml exec -T api node apps/api/dist/check-infra.js
```

마지막 명령에서 `PostgreSQL OK`와 `Object storage bucket OK`를 확인한다. 저장소 초기화 중이라면 잠시 뒤 다시 실행한다. 외부 브라우저에서 HTTPS 사이트를 열고 마스터 계정으로 로그인한다. 계정 관리에서 공간 접근을 부여한 뒤 폴더를 만들고 작은 TXT를 업로드한다. 다운로드한 파일이 원본과 일치하는지 확인한 다음, 실제 최대 크기(10 MiB) 파일도 한 건 시험한다.

## 5. 메모리·디스크 운영과 업데이트

`docker stats --no-stream`, `free -h`, `df -h`로 첫 업로드 전후를 비교한다. API는 업로드 본문을 메모리에 보관하므로 여러 10 MiB 파일이 동시에 들어오면 메모리 사용량이 증가한다. 컨테이너가 재시작되면 `docker inspect --format '{{.State.OOMKilled}} {{.RestartCount}}' "$(docker compose -f compose.yml ps -q api)"`와 해당 서비스 로그를 확인한다. 반복적으로 메모리가 부족하면 동시 사용량을 줄이거나 메모리 증설 후 상한을 조정한다. 가용 디스크와 동시 사용자 수를 확인한 후 팀 문서를 옮긴다.

업데이트 전 쓰기를 멈추려면 앱 서버에서 `docker compose -f compose.yml stop web api objects`를 실행한다. DB 서버에서 전용 DB의 `pg_dump -Fc` 백업을 만들고, 같은 시점의 SeaweedFS 데이터 디렉터리 전체를 백업한다. 자격증명과 Caddy 인증서 볼륨도 별도로 보호한다. 사본은 서버 밖에 보관하고 별도 환경에서 DB와 원본을 함께 복원해 파일 다운로드를 확인한다.

새 버전은 3단계에서 새 태그로 빌드해 전송한 뒤 서버에서 `docker load`하고, 기존 `.env`의 이미지 태그만 바꿔 4단계의 기동·검증 명령을 실행한다. DB 마이그레이션이 있는 버전을 되돌릴 때는 구버전과 호환되는 DB·원본 백업 시점을 맞춘다.
