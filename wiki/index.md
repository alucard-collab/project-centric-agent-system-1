# PCAS LLM-Wiki Index

> **Project-Centric Agent System (PCAS)**
> 지능형 에이전트들이 협업하여 프로젝트를 수행하는 차세대 멀티 에이전트 시스템의 지식 저장소입니다.

## 🗺️ Wiki Map

### 🏗️ Architecture & Decisions
- [[adr/001-initial-design|ADR-001: 초기 시스템 설계]] - 채널 기반 구조 및 주니어-시니어 루프 결정
- [[concepts/bridge-protocol|Bridge Protocol]] - 에이전트 간 메시지 규격 (준비 중)

### 🚀 Roadmap & Progress
- [[tasks|Implementation Checklist]] - 개발 단계별 작업 현황

### 📝 Development History
- [[log|Development Log]] - 날짜별 개발 기록

---

## 🧭 Core Concepts
1. **Channel-Based Execution**: 모든 작업은 독립된 채널(Session)에서 수행됩니다.
2. **Junior-Senior Verification**: 주니어의 초안을 시니어가 검토하여 품질을 보장합니다.
3. **Escalation Policy**: 3회 이상 루프 반복 시 사용자 개입을 요청합니다.

---
*Last Updated: 2026-05-16*
