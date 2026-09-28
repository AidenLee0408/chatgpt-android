# Persona Hub 인프라

AWS 서울 리전(`ap-northeast-2`), 2개 AZ. Terraform 루트 모듈 하나(`terraform/`)를 환경별 tfvars로 적용합니다.

## 구성 요약

| 영역 | 리소스 |
|---|---|
| 네트워크 | VPC(2 AZ), 퍼블릭 서브넷(ALB/NAT), 프라이빗 서브넷(ECS·RDS·Redis) |
| 진입점 | ALB, HTTPS(ACM 인증서, TLS1.2+), HTTP→HTTPS 리다이렉트 |
| 컴퓨트 | ECS Fargate(ARM64) 서비스 3개 — 동일 이미지, 경로 라우팅 |
| 데이터 | RDS PostgreSQL 16 멀티 AZ, 백업 7일(PITR), KMS 암호화, `rds.force_ssl` / ElastiCache Redis 7(TLS·AUTH·저장 암호화) |
| 비밀 | KMS 봉투암호화 키(ECS task role만 Encrypt/Decrypt/GenerateDataKey), Secrets Manager |
| 관측 | OpenTelemetry(ADOT 사이드카) → X-Ray/CloudWatch, CloudWatch 알람 → SNS |

경로 라우팅:

| 서비스 | 경로 |
|---|---|
| api | `/v1/*` |
| oauth | `/oauth*`, `/authorize*`, `/token*`, `/register*`, `/.well-known/oauth-authorization-server*` |
| mcp | `/mcp*`, `/.well-known/oauth-protected-resource*` |

각 컨테이너는 `SERVICE_ROLE`(api/oauth/mcp) 환경변수를 받습니다. 현재 서버는 단일 프로세스로 모든 경로를 처리하므로 그대로 동작하며, 추후 역할별로 라우트를 제한할 수 있습니다.

## 환경

| 환경 | 파일 | 특징 |
|---|---|---|
| staging | `envs/staging.tfvars` | 서비스당 태스크 1개, t4g.micro DB, Redis 단일 노드, 삭제 보호 off |
| production | `envs/production.tfvars` | 서비스당 최소 2개(AZ 분산), t4g.medium DB 멀티 AZ, Redis 복제본 1 |

```
cd persona-hub/infra/terraform
terraform init -backend-config=envs/staging.backend.hcl
terraform plan -var-file=envs/staging.tfvars -var image_uri=<ECR URI:SHA>
```

`PLACEHOLDER`로 표시된 값(계정 ID, ACM ARN, state 버킷/락 테이블, 알림 메일)은 실제 값으로 교체해야 합니다. ECR 저장소는 staging 스택에서 생성하고 production이 같은 이미지를 사용합니다(교차 계정 시 저장소 정책 추가 필요).

## 배포 흐름

1. PR: `persona-hub.yml` — 서버 타입체크 + 테스트(**"persona-hub permission gate & tests"**, 권한 테스트 필수 게이트, 브랜치 보호의 required check로 지정), 모바일 `tsc --noEmit`.
2. `main` 머지: `persona-hub-deploy.yml`
   - 게이트 재실행 → ARM64 이미지 빌드, ECR 푸시(태그 = 커밋 SHA, immutable)
   - **staging 자동 배포**(terraform apply → `ecs wait services-stable` → `/healthz` 스모크)
   - **production**: GitHub Environment `persona-hub-production`의 Required reviewers 승인 후 동일 이미지 배포
3. ECS 배포 서킷 브레이커가 헬스체크 실패 시 자동 롤백.
4. 모바일 앱: EAS Build(스토어 빌드) + EAS Update(OTA, JS 변경만). 이 저장소 파이프라인 범위 밖이며 채널은 `staging`/`production`으로 맞춥니다.

AWS 인증은 GitHub OIDC 역할 가정만 사용합니다(정적 키 금지). 필요한 GitHub 설정:
- 저장소 변수: `AWS_ACCOUNT_ID`, `PERSONA_HUB_BUILD_ROLE_ARN`
- 환경 변수(환경별): `DEPLOY_ROLE_ARN`, `PERSONA_HUB_BASE_URL`
- IAM 역할 신뢰 정책: `token.actions.githubusercontent.com`, `sub = repo:<org>/<repo>:environment:persona-hub-production` 등으로 제한

## 시크릿 목록 (Secrets Manager, `persona-hub/<env>/…`)

| 이름 | 컨테이너 env | 용도 |
|---|---|---|
| `database-url` | `DATABASE_URL` | 앱용 Postgres 접속 문자열(최소 권한 앱 유저) |
| `oauth-signing-key` | `OAUTH_SIGNING_KEY` | OAuth 토큰 서명 키 |
| `session-secret` | `SESSION_SECRET` | 세션/CSRF |
| `redis-auth-token` | `REDIS_AUTH_TOKEN` | ElastiCache AUTH 토큰 |

- RDS 마스터 비밀번호는 `manage_master_user_password`로 RDS가 직접 관리(Terraform state에 남지 않음).
- 시크릿 값은 Terraform 밖(콘솔/CLI)에서 설정. `redis-auth-token`은 첫 apply 전에 값이 있어야 합니다.
- 봉투암호화 KMS 키 ARN은 비밀이 아니므로 `KMS_ENVELOPE_KEY_ID` 일반 env로 주입.

## 비용 (MVP: 사용자 1만 명, 일 10만 MCP 호출)

일 10만 호출 ≈ 평균 1.2 RPS, 피크 10~20 RPS 수준으로 작은 규모입니다.

- Fargate ARM64(Graviton) 0.25~0.5 vCPU 태스크로 충분. 운영 최소 6태스크(서비스 3×2 AZ)가 가용성 하한.
- NAT 게이트웨이 1개(월 약 $35 + 트래픽). AZ 장애 내성이 더 필요하면 AZ별 NAT로 확장. ECR/S3/Secrets용 VPC 엔드포인트를 추가하면 NAT 트래픽 절감 가능.
- RDS t4g.medium 멀티 AZ가 운영 비용의 가장 큰 항목. 스테이징은 비용 절감을 위해 `db_multi_az=false`를 고려.
- Redis cache.t4g.small + 복제본 1. 스테이징 단일 micro 노드.
- 로그 30일 보관, 컨테이너 인사이트는 필요 없으면 스테이징에서 끌 수 있음.
- 대략 운영 월 $300~450, 스테이징 월 $120~180 (트래픽·로그량에 따라 변동, 추정치).

## 관측성

- **OpenTelemetry**: 앱은 OTLP(`OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317`)로 ADOT 사이드카에 전송 → X-Ray 트레이스, CloudWatch 메트릭. `OTEL_SERVICE_NAME=persona-hub-<role>`.
- 수집 대상: 요청 수/지연, 상태 코드, MCP 도구 이름, 권한 결정 결과(allow/deny + 스코프), 사용자/클라이언트는 해시 ID만.
- **팩트 본문은 절대 로그·트레이스·메트릭 속성에 남기지 않습니다.** 요청/응답 바디 로깅 금지, span attribute는 허용 목록 방식, DB `log_statement=none`, 에러 메시지에서 사용자 데이터 제거. 로그 그룹은 KMS 암호화.
- 알람(SNS → 이메일, 추후 Slack/PagerDuty):
  - MCP 5xx 비율 > 1% (5분 × 2)
  - 서비스별 ALB p95 응답시간 > 1초 (5분 × 3)
  - 권한 테스트 실패: 커스텀 메트릭 `PersonaHub/PermissionTestFailures{Environment}` > 0. 배포 후 스모크/정기 합성 권한 프로브가 실패 시 `aws cloudwatch put-metric-data`로 게시(프로브 구현은 TODO).
