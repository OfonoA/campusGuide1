from dataclasses import dataclass
from typing import Any, Dict, Optional

try:
    from langchain_core.document import Document  # type: ignore[import]
except ModuleNotFoundError:
    @dataclass
    class Document:
        page_content: str
        metadata: Optional[Dict[str, Any]] = None
