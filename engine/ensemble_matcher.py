"""Hybrid Ensemble Matching Engine for SETU.

Combines Domain Alias Expansion, RapidFuzz Lexical Matching, and
Sentence-Transformers Semantic Embeddings into an explainable confidence score.
"""

from datetime import datetime, timezone
from typing import Dict, List, Optional, Set
import numpy as np

from config import settings
from engine.alias_expander import DomainAliasExpander
from engine.embeddings import EmbeddingMatcher
from engine.fuzzy_matcher import FuzzyMatcher


class EnsembleMatcher:
    """Hybrid matching engine orchestrating lexical and semantic scoring."""

    def __init__(
        self,
        activities: List[Dict[str, str]],
        alias_expander: Optional[DomainAliasExpander] = None,
        fuzzy_matcher: Optional[FuzzyMatcher] = None,
        embedding_matcher: Optional[EmbeddingMatcher] = None,
    ):
        self.activities = activities
        self.alias_expander = alias_expander or DomainAliasExpander()
        self.fuzzy_matcher = fuzzy_matcher or FuzzyMatcher()
        self.embedding_matcher = embedding_matcher or EmbeddingMatcher()

        # Precompute & index embeddings for all schedule activities
        self.activity_embeddings = self.embedding_matcher.precompute_schedule_embeddings(self.activities)

    def reload_aliases(self, aliases: List[Dict]) -> None:
        """
        Hot-reloads domain aliases in-memory without recomputing schedule activity embeddings.
        Leaves self.activity_embeddings completely untouched.
        """
        self.alias_expander = DomainAliasExpander(aliases=aliases)

    def match_single_report(self, report: Dict, top_k: int = 3) -> Dict:
        """
        Executes hybrid matching for a single field report.
        
        Args:
            report: Dict containing 'field_text', 'source_type', 'reported_date', etc.
            top_k: Number of candidate activities to return (default 3).
            
        Returns:
            Structured match result with top candidate, top-3 candidate list,
            confidence score, confidence level, and explainable score components.
        """
        raw_text = report.get("field_text", "")
        source_type = report.get("source_type", "text")
        reported_date = report.get("reported_date", datetime.now(timezone.utc).strftime("%Y-%m-%d"))

        # Step 1: Domain Alias Expansion
        expanded_text, matched_aliases, detected_disciplines = self.alias_expander.expand(raw_text)

        # Step 2: Semantic Similarity (Sentence-Transformers)
        query_embedding = self.embedding_matcher.encode([expanded_text])[0]
        semantic_scores = self.embedding_matcher.compute_cosine_similarities(
            query_embedding, self.activity_embeddings
        )

        # Step 3: Combined Scoring against all activities
        candidate_list = []
        for idx, act in enumerate(self.activities):
            act_name = act["activity_name"]
            act_discipline = act.get("discipline", "")

            # Semantic score for this candidate
            sem_score = round(float(semantic_scores[idx]), 4)

            # Lexical fuzzy score against expanded text and raw text (take max)
            fuzz_raw = self.fuzzy_matcher.score(raw_text, act_name)
            fuzz_exp = self.fuzzy_matcher.score(expanded_text, act_name)
            fuzzy_score = max(fuzz_raw, fuzz_exp)

            # Discipline boost: +1.0 if candidate discipline matches alias or query context
            if act_discipline in detected_disciplines or act_discipline.lower() in raw_text.lower():
                discipline_boost = 1.0
            else:
                discipline_boost = 0.0

            # Weighted Explainable Formula:
            # 55% Semantic + 35% Fuzzy + 10% Discipline Boost
            final_score = (0.55 * sem_score) + (0.35 * fuzzy_score) + (0.10 * discipline_boost)
            final_score = round(min(1.0, max(0.0, final_score)), 4)

            candidate_list.append({
                "activity_id": act["activity_id"],
                "activity_name": act_name,
                "discipline": act_discipline,
                "wbs_code": act.get("wbs_code", ""),
                "semantic_score": sem_score,
                "fuzzy_score": fuzzy_score,
                "discipline_boost": discipline_boost,
                "final_score": final_score
            })

        # Rank candidates by final score descending
        candidate_list.sort(key=lambda x: x["final_score"], reverse=True)
        top_candidates = candidate_list[:top_k]

        primary_match = top_candidates[0] if top_candidates else None
        top_score = primary_match["final_score"] if primary_match else 0.0

        # Step 4: Confidence Classification
        if top_score >= settings.THRESHOLD_HIGH_CONFIDENCE:
            confidence_level = "High"
            matched_layer = "hybrid" if len(matched_aliases) > 0 else "semantic"
        elif top_score >= settings.THRESHOLD_MEDIUM_CONFIDENCE:
            confidence_level = "Medium"
            matched_layer = "hybrid"
        else:
            confidence_level = "Low"
            matched_layer = "unmatched"

        # Determine matched activity id
        # Low confidence preserves top candidate suggestion for planner review, but marks as Low
        matched_act_id = primary_match["activity_id"] if primary_match else None

        return {
            "update_id": report.get("update_id"),
            "source_type": source_type,
            "field_text": raw_text,
            "expanded_text": expanded_text,
            "applied_aliases": [a["field_term"] for a in matched_aliases],
            "matched_activity_id": matched_act_id,
            "top_activity_name": primary_match["activity_name"] if primary_match else "No match found",
            "top_activity_discipline": primary_match["discipline"] if primary_match else "None",
            "confidence_score": top_score,
            "confidence_level": confidence_level,
            "matched_layer": matched_layer,
            "candidate_matches": top_candidates,
            "status": "pending",  # All matches (High, Medium, Low) remain planner-reviewable
            "planner_remarks": None,
            "reported_date": reported_date,
            "created_at": datetime.now(timezone.utc).isoformat()
        }

    def match_all_reports(self, reports: List[Dict], top_k: int = 3) -> List[Dict]:
        """Runs the matching pipeline over a list of field reports."""
        results = []
        for rep in reports:
            res = self.match_report(rep, top_k=top_k)
            results.append(res)
        return results

    # Alias for compatibility
    match_report = match_single_report
