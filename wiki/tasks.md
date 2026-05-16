# PCAS Implementation Checklist

## Phase 1: 기반 시스템 구축 (Foundation)
- [ ] **1.1 프로젝트 환경 설정**
  - [ ] VS Code Extension Boilerplate 생성 (TypeScript)
  - [ ] 전역 설정 관리자 구현 (LLM API Key, 로컬 서버 주소 등)
  - [ ] 모델 정책 설정 구현
- [ ] **1.2 파일 기반 채널 엔진 (Session Manager)**
  - [ ] `.pcas/sessions/` 디렉토리 관리 로직 구현
  - [ ] 채널 ID 생성 및 폴더 자동 생성
- [ ] **1.3 CEO Planner 에이전트 구현**
  - [ ] CEO 전용 시스템 프롬프트(`planner.md`) 작성
  - [ ] JSON 작업 계획 생성 로직
  - [ ] 에이전트 배정(dispatch) 로직
- [ ] **1.4 Storage 모듈 구현**
  - [ ] 채널별 `shared_memory.md`, `logs.json`, `outputs/` I/O
  - [ ] Git 자동 동기화 연동

## Phase 2: 주니어-시니어 협업 루프 (Specialist Loop)
- [ ] **2.1 에이전트 브릿지 (Agent Bridge)**
  - [ ] JSON 메시지 라우팅 시스템
- [ ] **2.2 주니어 & 시니어 에이전트 세팅**
- [ ] **2.3 루프 및 종료 조건 구현 (핵심)**
  - [ ] Junior -> Senior -> Junior 순환
  - [ ] `Approve` 시그널 감지 및 종료
  - [ ] 3회 제한 및 에스컬레이션

## Phase 3: 사용자 인터페이스 (UI/UX)
- [ ] **3.1 3-Column 웹뷰 레이아웃**
- [ ] **3.2 실시간 이벤트 동기화**

## Phase 4: 도구 통합 및 실행 (Execution)
- [ ] **4.1 파일 시스템 도구 (File Tools)**
- [ ] **4.2 숏컷 로직 (Shortcuts)**

## Phase 5: 클라우드 및 고도화 (Advanced)
- [ ] **5.1 구글 드라이브 연동**
- [ ] **5.2 지식 데이터베이스 고도화**
