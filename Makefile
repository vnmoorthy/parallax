# Parallax — Many agents. Many branches. One answer.
# Self-documenting Makefile: `make` or `make help` lists targets.

SHELL := /bin/bash
.DEFAULT_GOAL := help

ROOT      := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
BACKEND   := $(ROOT)/backend
FRONTEND  := $(ROOT)/frontend
VENV      := $(BACKEND)/.venv
PY        := $(VENV)/bin/python
UVICORN   := $(VENV)/bin/uvicorn
PYTEST    := $(VENV)/bin/pytest
RUFF      := $(VENV)/bin/ruff
BACKEND_PORT  ?= 8000
FRONTEND_PORT ?= 3000
ROCKETRIDE_URI    ?= http://localhost:5565
ROCKETRIDE_APIKEY ?= MYAPIKEY

.PHONY: help setup dev backend frontend demo test lint pipes-validate datasets snyk docker-up docker-down clean

help: ## Show this help
	@echo "Parallax — make targets"
	@echo
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'
	@echo
	@echo "Ports: backend :$(BACKEND_PORT), frontend :$(FRONTEND_PORT). Copy .env.example to .env for sponsor keys (optional)."

setup: ## Install backend (uv) + frontend (pnpm) deps and generate the bundled datasets
	cd "$(BACKEND)" && uv sync --extra dev
	cd "$(FRONTEND)" && pnpm install
	$(MAKE) datasets

dev: ## Run backend :8000 + frontend :3000 together (scripts/dev.sh)
	BACKEND_PORT=$(BACKEND_PORT) FRONTEND_PORT=$(FRONTEND_PORT) "$(ROOT)/scripts/dev.sh"

backend: ## Run only the FastAPI backend with reload
	cd "$(BACKEND)" && "$(UVICORN)" app.main:app --reload --port $(BACKEND_PORT)

frontend: ## Run only the Next.js frontend
	cd "$(FRONTEND)" && pnpm dev -p $(FRONTEND_PORT)

demo: ## Zero-key demo: fake LLM + local DuckDB engine (no sponsor keys needed)
	PARALLAX_LLM_MODE=fake PARALLAX_DATA_MODE=local BACKEND_PORT=$(BACKEND_PORT) FRONTEND_PORT=$(FRONTEND_PORT) "$(ROOT)/scripts/dev.sh"

test: ## Backend pytest + frontend type-check and production build
	cd "$(BACKEND)" && "$(PYTEST)" -q
	cd "$(FRONTEND)" && pnpm exec tsc --noEmit && pnpm build

lint: ## ruff (backend) + eslint (frontend)
	cd "$(BACKEND)" && "$(RUFF)" check .
	cd "$(FRONTEND)" && pnpm lint

pipes-validate: ## Validate pipelines/*.pipe structurally (+ against a local engine if reachable)
	"$(PY)" "$(ROOT)/scripts/validate_pipes.py" --engine $(ROCKETRIDE_URI) --key $(ROCKETRIDE_APIKEY)

datasets: ## Generate synthetic CSVs and fetch the SF Airbnb dataset into datasets/
	"$(PY)" "$(ROOT)/scripts/generate_datasets.py"
	"$(PY)" "$(ROOT)/scripts/fetch_datasets.py"

snyk: ## Snyk dependency + code scan (requires `snyk auth`)
	cd "$(ROOT)" && snyk test --all-projects
	cd "$(ROOT)" && snyk code test || true

docker-up: ## Build and start backend + frontend with docker compose
	cd "$(ROOT)" && docker compose up --build -d
	@echo "backend  http://localhost:8000/api/health"
	@echo "frontend http://localhost:3000"

docker-down: ## Stop docker compose services
	cd "$(ROOT)" && docker compose down

clean: ## Remove build artefacts, caches and local run data (keeps .venv / node_modules)
	rm -rf "$(FRONTEND)/.next" "$(FRONTEND)/out" "$(FRONTEND)/tsconfig.tsbuildinfo"
	find "$(BACKEND)" -name __pycache__ -type d -prune -exec rm -rf {} + 2>/dev/null || true
	rm -rf "$(BACKEND)/.pytest_cache" "$(BACKEND)/.ruff_cache" "$(ROOT)/.parallax"
