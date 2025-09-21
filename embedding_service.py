import numpy as np
from typing import List
from yandex_cloud_ml_sdk import YCloudML
from config import settings
from models import EmbeddingVector


class EmbeddingService:
    def __init__(self) -> None:
        self.sdk: YCloudML = YCloudML(
            folder_id=settings.yandex_folder_id,
            auth=settings.yandex_api_key,
        )
        self.query_model = self.sdk.models.text_embeddings("query")
        self.doc_model = self.sdk.models.text_embeddings("doc")
    
    async def get_query_embedding(self, text: str) -> EmbeddingVector:
        embedding: List[float] = self.query_model.run(text)
        return EmbeddingVector(values=embedding)

    async def get_doc_embedding(self, text: str) -> EmbeddingVector:
        embedding: List[float] = self.doc_model.run(text)
        return EmbeddingVector(values=embedding)

    async def get_doc_embeddings(self, texts: List[str]) -> List[EmbeddingVector]:
        embeddings: List[List[float]] = [self.doc_model.run(text) for text in texts]
        return [EmbeddingVector(values=embedding) for embedding in embeddings]

    def calculate_similarity(
        self,
        query_embedding: EmbeddingVector,
        doc_embeddings: List[EmbeddingVector]
    ) -> List[float]:
        from scipy.spatial.distance import cdist
        
        query_embedding_array: np.ndarray = np.array(query_embedding.to_list())
        doc_embeddings_array: np.ndarray = np.array([emb.to_list() for emb in doc_embeddings])

        dist: np.ndarray = cdist([query_embedding_array], doc_embeddings_array, metric="cosine")
        sim: np.ndarray = 1 - dist[0]
        return sim.tolist()


embedding_service: EmbeddingService = EmbeddingService()
