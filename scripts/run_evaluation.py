#!/usr/bin/env python3
"""Convenience Runner for SETU Benchmark Evaluation.

PS SIH26122 - Oil India Limited (SIH 2026).
Runs the full evaluation harness and displays results.

Usage:
    python scripts/run_evaluation.py
    python scripts/run_evaluation.py --json
"""

import sys
from pathlib import Path

# Add project root to sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from engine.evaluate import main

if __name__ == "__main__":
    main()
