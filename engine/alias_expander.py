"""Domain Alias Expander for Oil & Gas Infrastructure Terminology.

Normalizes colloquial field jargon, abbreviations, and informal site phrasing
into standard Primavera P6 engineering terminology.
"""

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from config import settings


class DomainAliasExpander:
    """Expands field terms using domain dictionary."""

    def __init__(
        self,
        aliases: Optional[List[Dict[str, Any]]] = None,
        alias_file: Optional[Path] = None
    ):
        if aliases is not None:
            self.alias_file = alias_file
            # Only verified aliases participate in expansion
            self.aliases: List[Dict[str, Any]] = [
                a for a in aliases if a.get("status", "verified") == "verified"
            ]
        else:
            self.alias_file = alias_file or settings.DOMAIN_ALIASES_PATH
            raw = self._load_aliases()
            self.aliases: List[Dict[str, Any]] = [
                a for a in raw if a.get("status", "verified") == "verified"
            ]
        # Sort terms by length descending to match multi-word phrases first (e.g. "tie-in" before "tie")
        self.sorted_terms = sorted(self.aliases, key=lambda x: len(x["field_term"]), reverse=True)

    def _load_aliases(self) -> List[Dict[str, str]]:
        if not self.alias_file.exists():
            return []
        with open(self.alias_file, "r", encoding="utf-8") as f:
            return json.load(f)

    def expand(self, text: str) -> Tuple[str, List[Dict[str, str]], Set[str]]:
        """
        Expands abbreviations and jargon in field text.
        
        Returns:
            Tuple of:
              - expanded_text: Cleaned text with standard terms appended/reinforced
              - matched_aliases: List of alias dictionaries applied
              - detected_disciplines: Set of disciplines inferred from matching aliases
        """
        if not text or not text.strip():
            return "", [], set()

        text_lower = text.lower()
        matched_aliases: List[Dict[str, str]] = []
        detected_disciplines: Set[str] = set()
        standard_phrases: List[str] = []

        for alias in self.sorted_terms:
            field_term = alias["field_term"].lower()
            # Boundary match or exact phrase search
            pattern = r"(?i)\b" + re.escape(field_term) + r"\b"
            if re.search(pattern, text_lower):
                matched_aliases.append(alias)
                detected_disciplines.add(alias.get("discipline", ""))
                standard_phrases.append(alias["standard_term"])

        # Create enriched query combining original text with standard engineering vocabulary
        if standard_phrases:
            # Deduplicate standard phrases preserving order
            unique_phrases = []
            for p in standard_phrases:
                if p not in unique_phrases:
                    unique_phrases.append(p)
            expanded_text = f"{text} (Domain Expansion: {'; '.join(unique_phrases)})"
        else:
            expanded_text = text

        return expanded_text, matched_aliases, detected_disciplines
