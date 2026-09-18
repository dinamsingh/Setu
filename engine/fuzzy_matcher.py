"""Lexical and Fuzzy String Matcher using RapidFuzz.

Computes token-based string similarity between field updates and
Primavera P6 activity descriptions.
"""

import re
from typing import Dict, List, Optional
from rapidfuzz import fuzz


class FuzzyMatcher:
    """Computes lexical fuzzy similarity scores."""

    @staticmethod
    def normalize_text(text: str) -> str:
        """Lowercases and cleans extra whitespace and symbols."""
        if not text:
            return ""
        # Keep alphanumeric, hyphen, quotes, and standard punctuation
        text = text.lower().strip()
        text = re.sub(r"\s+", " ", text)
        return text

    def score(self, query: str, target: str) -> float:
        """
        Calculates normalized fuzzy score between 0.0 and 1.0.
        
        Blends token_set_ratio (handles unordered words & extra words)
        with token_sort_ratio for robust lexical comparison.
        """
        q_norm = self.normalize_text(query)
        t_norm = self.normalize_text(target)

        if not q_norm or not t_norm:
            return 0.0

        # token_set_ratio accounts for subset matching (e.g. short query in long task title)
        token_set = fuzz.token_set_ratio(q_norm, t_norm)
        token_sort = fuzz.token_sort_ratio(q_norm, t_norm)

        # 70% token_set + 30% token_sort
        blended = (0.70 * token_set) + (0.30 * token_sort)
        return round(float(blended / 100.0), 4)

    def rank_candidates(
        self,
        query: str,
        activities: List[Dict[str, str]],
        top_k: int = 3
    ) -> List[Dict]:
        """Ranks all activities by fuzzy score and returns top_k."""
        scored = []
        for act in activities:
            s = self.score(query, act["activity_name"])
            scored.append({
                **act,
                "fuzzy_score": s
            })

        scored.sort(key=lambda x: x["fuzzy_score"], reverse=True)
        return scored[:top_k]
