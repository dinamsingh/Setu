"""Semantic Embedding and Vector Similarity Matcher.

Uses sentence-transformers (all-MiniLM-L6-v2) to generate 384-dimensional dense
embeddings and compute cosine similarity against schedule activities.
"""

from pathlib import Path
from typing import Dict, List, Optional
import numpy as np
from sentence_transformers import SentenceTransformer

from config import settings


class EmbeddingMatcher:
    """Manages sentence-transformers model and vector cosine computations."""

    _instance = None
    _model = None

    def __new__(cls, *args, **kwargs):
        """Singleton to prevent reloading the model multiple times."""
        if cls._instance is None:
            cls._instance = super(EmbeddingMatcher, cls).__new__(cls)
        return cls._instance

    def __init__(self, model_name: Optional[str] = None):
        if self._model is None:
            name = model_name or settings.EMBEDDING_MODEL_NAME
            # Loads all-MiniLM-L6-v2 locally
            self._model = SentenceTransformer(name)
        self.cached_activity_embeddings: Optional[np.ndarray] = None
        self.cached_activity_ids: List[str] = []

    def encode(self, texts: List[str], show_progress_bar: bool = False) -> np.ndarray:
        """Encodes a list of texts into normalized 384-dim embeddings."""
        if not texts:
            return np.empty((0, 384), dtype=np.float32)
        embeddings = self._model.encode(
            texts,
            show_progress_bar=show_progress_bar,
            normalize_embeddings=True,
            convert_to_numpy=True
        )
        return embeddings

    def precompute_schedule_embeddings(
        self,
        activities: List[Dict[str, str]],
        cache_file: Optional[Path] = None
    ) -> np.ndarray:
        """Precomputes embeddings for all schedule activities."""
        # Use rich representation: Discipline + WBS Name + Activity Name for maximum semantic signal
        texts_to_embed = [
            f"[{act.get('discipline', '')}] {act.get('wbs_name', '')}: {act['activity_name']}"
            for act in activities
        ]
        embeddings = self.encode(texts_to_embed, show_progress_bar=False)
        self.cached_activity_embeddings = embeddings
        self.cached_activity_ids = [act["activity_id"] for act in activities]

        if cache_file:
            np.save(cache_file, embeddings)

        return embeddings

    def compute_cosine_similarities(
        self,
        query_embedding: np.ndarray,
        corpus_embeddings: Optional[np.ndarray] = None
    ) -> np.ndarray:
        """
        Calculates cosine similarity between a 1D query vector and a 2D corpus matrix.
        Vectors are L2-normalized, so dot product = cosine similarity.
        Normalized to range [0.0, 1.0].
        """
        targets = corpus_embeddings if corpus_embeddings is not None else self.cached_activity_embeddings
        if targets is None or len(targets) == 0:
            return np.array([], dtype=np.float32)

        # Dot product with normalized vectors
        dots = np.dot(targets, query_embedding)
        # Cosine similarity for all-MiniLM is generally between 0 and 1 for positive text similarity;
        # Clip to [0.0, 1.0] for clean probability representation
        clipped = np.clip(dots, 0.0, 1.0)
        return clipped
